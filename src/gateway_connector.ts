import { readFileSync } from 'fs';
import { Client } from 'ssh2';
import { promisify } from 'util';
const { exec, spawn } = require('child_process')
import { Logger } from './logger';
import { ConnectionOptions } from './interfaces/connection_options';
import { EventEmitter } from 'events';
import { cloneDeep } from 'lodash';

export class GatewayConnector extends EventEmitter {
  public eventEmitter: EventEmitter;
  private conn: Client;
  private sshHost: string;
  private sshUsername: string;
  private sshPassword: string;
  private logger: any
  private connectOptions!: ConnectionOptions;

  constructor(host: string, username: string, password: string) {
    super();
    this.logger = (new Logger()).createLogger();
    this.conn = new Client();
    this.sshHost = host;
    this.sshUsername = username;
    this.sshPassword = password;
    this.eventEmitter = new EventEmitter();
  }

  // If you want to use certificate call this after constructor
  private createNewKey = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const { stdout, stderr } = await promisify(exec)('bash ./src/scripts/ssh-keygen.bash');
        if (stderr) {
          reject(stderr);
        } else {
          resolve(stdout);
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private sftpFileTransfer(from: string, to: string) {
    return new Promise((resolve, reject) => {
      this.conn.sftp((err, sftp) => {
        if (err) {
          sftp.end();
          reject(err);
        }
        sftp.fastPut(from, to, (error) => {
          if (error) {
            sftp.end();
            reject(error)
          } else {
            sftp.end();
            resolve()
          }
        })
      });
    })
  }

  // Connect via ssh to gateway
  connect(options: ConnectionOptions) {
    options = { timeout: 60000, ...options }
    this.connectOptions = options;
    return new Promise((resolve, reject) => {
      this.conn.on('end', () => {
        // options.connectionEndCallback.call(this)
        this.logger.info('SSH disconnected');
      })
      this.conn.on('error', (error) => {
        options.onError.call(this)
        this.logger.error('SSH Error', error);
      })
      this.conn.on('ready', async () => {
        this.logger.info('SSH connected')
        options.onSuccess();
        try {
          await this.sftpFileTransfer('.ssh/id_rsa.pub', '.ssh/authorized_keys')
          this.logger.info('Copied ssh certificate on gateway')
          resolve();
        } catch (error) {
          reject(error)
        }
      })
      const privateKey = readFileSync('.ssh/id_rsa', 'UTF-8')
      this.conn.connect({
        host: this.sshHost,
        username: this.sshUsername,
        password: this.sshPassword,
        privateKey: privateKey,
        readyTimeout: options.timeout,
        keepaliveInterval: 1000
      });
    })

  }

  private execToPromise(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.conn.exec(command, (err, stream) => {
        if (err) throw err;
        let data = '';
        stream.on('close', (_code: any, _signal: any) => {
          stream.end()
          resolve(data)
        }).on('data', (newData: any) => {
          data += newData
        }).stderr.on('data', (data) => {
          stream.end()
          reject('STDOUT: ' + data);
        });
      })
    })
  }

  private waitReboot() {
    let percentage = 35;
    this.conn.removeAllListeners();
    this.conn.end();
    const oldOptions = cloneDeep(this.connectOptions)
    const interval = setInterval(() => {
      percentage = percentage + 10;
      console.log(percentage)
      this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: percentage > 90 ? 90 : percentage, stage: 'rebooting' })
    }, 10000)
    setTimeout(() => {
      this.connect({
        ...this.connectOptions,
        onSuccess: () => {
          clearInterval(interval);
          this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 100, stage: 'done' });
          setTimeout(() => {
            this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 0, stage: null })
            this.conn.removeAllListeners();
            this.conn.end();
            this.connect(oldOptions);
          }, 10000)
        }
      });
    }, 5000)
  }

  private async fileExistsOnGateway(path: string): Promise<boolean> {
    try {
      const result = await this.execToPromise(`test -f ${path} && echo true`);
      if (result.trim()) {
        console.log(path, "exists")
        return true;
      }
      console.log(path, "NOT exists")
      return false;
    } catch (_err) {
      return false;
    }
  }

  private async transferScripts() {
    return Promise.all([
      this.execToPromise('mkdir /tmp/scripts 2> /dev/null'),
      this.sftpFileTransfer('src/scripts/install_scripts/install_esf.bash', '/tmp/scripts/install_esf.bash'),
      this.sftpFileTransfer('src/scripts/install_scripts/install_packages.bash', '/tmp/scripts/install_packages.bash'),
      this.sftpFileTransfer('src/scripts/install_scripts/install_snapshot.bash', '/tmp/scripts/install_snapshot.bash'),
      this.sftpFileTransfer('src/scripts/install_scripts/led.bash', '/tmp/scripts/led.bash'),
      this.sftpFileTransfer('src/scripts/install_scripts/reboot.bash', '/tmp/scripts/reboot.bash'),
      this.sftpFileTransfer('src/scripts/update_esf.bash', '/tmp/scripts/update_esf.bash'),
    ])
  }

  installEsf(esfPath: string, snapshotPath: string, packagesPath: string[]) {
    return new Promise(async (resolve, reject) => {
      try {
        const esfFleName = esfPath.substring(esfPath.lastIndexOf('/') + 1);
        const snapshotName = snapshotPath.substring(snapshotPath.lastIndexOf('/') + 1);
        await this.execToPromise('rm -rf /tmp/esf*')
        await this.sftpFileTransfer(esfPath, `/tmp/${esfFleName}`);
        await this.sftpFileTransfer(snapshotPath, `/tmp/${snapshotName}`);
        packagesPath.forEach(async packagePath => {
          const packagesName = packagePath.substring(packagePath.lastIndexOf('/') + 1);
          await this.sftpFileTransfer(packagePath, `/tmp/${packagesName}`);
        })
        this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 10, stage: 'copying_files' })
        await this.transferScripts();
        const packagesParams = packagesPath.map(packagePath => {
          return `-p ${packagePath.substring(packagePath.lastIndexOf('/') + 1)}`
        }).join(' ')
        // this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 20, stage: 'copying_files' })
        try {
          await this.execToPromise(`bash /tmp/scripts/led.bash on`)
          this.logger.info('Turned led on')
          await this.execToPromise(`bash /tmp/scripts/install_packages.bash ${packagesParams}`)
          setTimeout(() => {
            this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 23, stage: 'installing_snapshot' })
          }, 10000)
          await this.execToPromise(`bash /tmp/scripts/install_esf.bash /tmp/${esfFleName}`)
          this.logger.info('Installed ESF')
          this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 31, stage: 'installing_snapshot' })
          await this.execToPromise(`bash /tmp/scripts/install_snapshot.bash /tmp/${snapshotName}`)
          this.logger.info('Installed snapshot')
          this.eventEmitter.emit('flashGatewayUpdate', { flashing_percentage: 35, stage: 'rebooting' })
          await this.execToPromise(`bash /tmp/scripts/reboot.bash`)
          this.logger.info('Rebooting gateway')
          this.waitReboot();
          resolve()
        } catch (error) {
          this.logger.info('rejecting')
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private getGatewayVersion(): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await this.execToPromise('uname -n')
        resolve(result.trim())
      } catch (error) {
        reject(`Error getting gatway version: ${error} `)
      }
    })
  }

  private getESFVersion(): Promise<string> {
    // eurotech_versions
    // eth_vers*
    // opt/eurotech/esf/framework/kura.properties
    return new Promise(async (resolve, reject) => {
      // const result = await ssh.execCommand('rpm -qa | grep esf')
      try {
        const rpmPackageName = await this.execToPromise('rpm -qa | grep esf');
        if (rpmPackageName) {
          resolve(rpmPackageName.trim())
        } else {
          this.logger.error('Error getting ESF version: not found')
        }
      } catch (error) {
        reject(`Error getting ESF version: ${error} `)
      }
    })
  }

  closeSSHConnection() {
    this.conn.end();
  }

  handleError(error: string) {
    this.logger.error(error);
    this.closeSSHConnection();
  }

  async getGatewayInfo() {
    try {
      const promise1 = this.getGatewayVersion();
      const promise2 = this.getESFVersion();
      const [gatewayVersion, esfRpmPackageName] = await Promise.all([promise1, promise2])
      let esfVersion = null
      if (esfRpmPackageName) {
        const matchArray = esfRpmPackageName.match(/[0-9]\.[0-9]\.[0-9]/)
        if (matchArray && matchArray.length === 1) {
          esfVersion = (matchArray[0])
        }
      }
      return {
        gateway_version: gatewayVersion,
        esf_version: esfVersion,
        esf_rpm_package_name: esfRpmPackageName
      }
    } catch (error) {
      this.handleError(error)
    }
  }
}
