const { readFileSync } = require('fs')
const { Client } = require('ssh2');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { getLogger } = require('./logger');

class GatewayConnector {
  constructor() {
    this.conn = undefined;
    this.sshHost = undefined;
    this.sshUsername = undefined;
    this.sshPassword = undefined;
  }

  // If you want to use certificate call this after constructor
  createNewKey = () => {
    return new Promise(async (resolve, reject) => {
      try {
        const { stdout, stderr } = await exec('bash ./src/scripts/ssh-keygen.bash');
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


  sftpFileTransfer(conn, from, to) {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
        }
        sftp.fastPut(from, to, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      });
    })
  }

  // Connect via ssh to gateway
  connect(host, username, password, options) {
    options = { timeout: 60000, ...options }
    return new Promise((resolve, reject) => {
      this.sshHost = host;
      this.sshUsername = username;
      this.sshPassword = password;
      const conn = new Client();
      conn.on('end', () => {
        // options.connectionEndCallback.call(this)
        getLogger().info('SSH disconnected');
      })
      conn.on('error', (error) => {
        options.onError.call(this)
        getLogger().error('SSH Error', error);
      })
      conn.on('ready', async () => {
        getLogger().info('SSH connected')
        this.conn = conn;
        options.onSuccess();
        try {
          await this.sftpFileTransfer(conn, '.ssh/id_rsa.pub', '.ssh/authorized_keys')
          getLogger().info('Copied ssh certificate on gateway')
          resolve();
        } catch (error) {
          reject(error)
        }
      })
      const privateKey = readFileSync('.ssh/id_rsa', 'UTF-8')
      conn.connect({
        host: host,
        username: username,
        password: password,
        privateKey: privateKey,
        readyTimeout: options.timeout,
        keepaliveInterval: 1000
      });
    })

  }

  execToPromise(command) {
    return new Promise((resolve, reject) => {
      this.conn.exec(command, (err, stream) => {
        if (err) throw err;
        let data = '';
        stream.on('close', (code, signal) => {
          resolve(data)
        }).on('data', (newData) => {
          data += newData
        }).stderr.on('data', (data) => {
          reject('STDOUT: ' + data);
        });
      })
    })
  }

  removeEsfVersion() {
    return new Promise(async (resolve, reject) => {
      const rpmPackageName = await this.execToPromise('rpm -qa | grep esf')
      if (!rpmPackageName) {
        getLogger().warn("For some reason there is no esf rpm package already installed")
      } else {
        try {
          getLogger().info(`cmd: rpm -e ${rpmPackageName.trim()}`)
          await this.execToPromise(`rpm -e ${rpmPackageName.trim()}`)
        } catch (error) {
          // TODO: this is probably a warning, filter only warnings and throw error otherwise
          getLogger().error(error);
        }
      }
      try {
        // Turn led 1 and 2 amber
        await this.execToPromise('echo 0 > /sys/class/leds/led1-green/brightness')
        await this.execToPromise('echo 0 > /sys/class/leds/led2-green/brightness')
        await this.execToPromise('echo 1 > /sys/class/leds/led1-amber/brightness')
        await this.execToPromise('echo 1 > /sys/class/leds/led2-amber/brightness')
      } catch {
        getLogger().error('There was a problem turning leds amber')
      }
      try {
        getLogger().info('cmd: rm -fr /opt/eurotech/esf*')
        await this.execToPromise('rm -fr /opt/eurotech/esf*')
        resolve();
      } catch (error) {
        reject(`Error removing ESF: ${error}`)
      }
    })
  }

  installEsf(esfPath, snapshotPath, packagesPath) {
    return new Promise(async (resolve, reject) => {
      try {
        const esfFleName = esfPath.substring(esfPath.lastIndexOf('/') + 1);
        const snapshotName = snapshotPath.substring(snapshotPath.lastIndexOf('/') + 1);
        await this.execToPromise('rm -rf /tmp/esf*')
        await this.sftpFileTransfer(this.conn, esfPath, `/tmp/${esfFleName}`);
        await this.sftpFileTransfer(this.conn, snapshotPath, `/tmp/${snapshotName}`);
        packagesPath.forEach(async packagePath => {
          const packagesName = packagePath.substring(packagePath.lastIndexOf('/') + 1);
          await this.sftpFileTransfer(this.conn, packagePath, `/tmp/${packagesName}`);
        })
        // await this.execToPromise('org.eclipse.kura.configuration.remote=file\:/opt/eclipse/kura/kura/packages/org.eclipse.kura.configuration.remote_1.0.0.dp')
        getLogger().info('Copied ESF rpm and snapshot to gateway')

        await this.sftpFileTransfer(this.conn, 'src/scripts/update_esf.bash', '/tmp/update_esf.bash');
        const packagesParams = packagesPath.map(packagePath => {
          return `-p ${packagePath.substring(packagePath.lastIndexOf('/') + 1)}`
        }).join(' ')
        try {
          getLogger().info(`Transfered bash file: bash /tmp/update_esf.bash ${packagesParams} -e /tmp/${esfFleName}`)
          const installScriptResult = await this.execToPromise(`bash /tmp/update_esf.bash ${packagesParams} -e /tmp/${esfFleName} -s /tmp/${snapshotName}`)
          getLogger().info(installScriptResult);
          resolve()
        } catch (error) {
          getLogger().info('rejecting')
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  getGatewayVersion() {
    return new Promise(async (resolve, reject) => {
      try {
        const result = await this.execToPromise('uname -n')
        resolve(result.trim())
      } catch (error) {
        reject(`Error getting gatway version: ${error} `)
      }
    })
  }

  getESFVersion() {
    // eurotech_versions
    // eth_vers*
    // opt/eurotech/esf/framework/kura.properties
    return new Promise(async (resolve, reject) => {
      // const result = await ssh.execCommand('rpm -qa | grep esf')
      try {
        const rawString = await this.execToPromise('rpm -qa | grep esf');
        const matchArray = rawString.match(/[0-9]\.[0-9]\.[0-9]/)
        if (matchArray && matchArray.length === 1) {
          return resolve(matchArray[0])
        }
        getLogger().error('Error getting ESF version: not found')
        resolve()
      } catch (error) {
        reject(`Error getting ESF version: ${error} `)
      }
    })
  }

  closeSSHConnection() {
    this.conn.end();
  }

  handleError(error) {
    getLogger().error(error);
    this.closeSSHConnection();
  }

  async getGatewayInfo() {
    try {
      const promise1 = this.getGatewayVersion();
      const promise2 = this.getESFVersion();
      let gatewayVersion;
      let ESFVersion;
      [gatewayVersion, ESFVersion] = await Promise.all([promise1, promise2])
      return {
        gateway_version: gatewayVersion,
        esf_version: ESFVersion
      }
    } catch (error) {
      this.handleError(error)
    }
  }
}

module.exports = {
  GatewayConnector
}
