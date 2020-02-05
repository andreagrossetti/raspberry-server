const { readFileSync } = require('fs')
const { Client } = require('ssh2');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

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
        const { stdout, stderr } = await exec('bash ssh-keygen.bash');
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
        console.log('SSH disconnected');
      })
      conn.on('error', (error) => {
        options.onError.call(this)
        console.error('SSH Error', error);
      })
      conn.on('ready', async () => {
        console.log('SSH connected')
        this.conn = conn;
        options.onSuccess();
        try {
          await this.sftpFileTransfer(conn, '.ssh/id_rsa.pub', '.ssh/authorized_keys')
          console.log('Copied ssh certificate on gateway')
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
        console.log("For some reason there is no esf rpm package already installed")
      } else {
        try {
          console.log(`cmd: rpm -e ${rpmPackageName.trim()}`)
          await this.execToPromise(`rpm -e ${rpmPackageName.trim()}`)
        } catch (error) {
          // TODO: this is probably a warning, filter only warnings and throw error otherwise
          console.log(error);
        }
      }
      try {
        console.log('cmd: rm -fr /opt/eurotech/esf*')
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
        await this.sftpFileTransfer(this.conn, esfPath, `/tmp/${esfFleName}`);
        await this.sftpFileTransfer(this.conn, snapshotPath, `/tmp/${snapshotName}`);
        packagesPath.forEach(async packagePath => {
          const packagesName = packagePath.substring(packagePath.lastIndexOf('/') + 1);
          await this.sftpFileTransfer(this.conn, packagePath, `/tmp/${packagesName}`);
        })
        console.log('Copied ESF rpm and snapshot to gateway')
        // Uninstall olf ESF
        try {
          await this.removeEsfVersion();
          console.log('resolving')
          resolve()
        } catch (error) {
          console.log('rejecting')
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
        const result = await this.execToPromise('rpm -qa | grep esf')
        const rawString = result;
        const matchArray = rawString.match(/[0-9]\.[0-9]\.[0-9]/)
        if (matchArray && matchArray.length === 1) {
          resolve(matchArray[0])
        }
        console.error('Error getting ESF version: not found')
        resolve()
      } catch (error) {
        reject(`Error getting ESF version: ${error} `)
      }
    })
  }

  // defaultConnect(connectionEndCallback, connectionErrorCallback) {
  //   return this.connect('172.16.0.1', 'root', 'eurotech', null, connectionEndCallback, connectionErrorCallback)
  // }

  closeSSHConnection() {
    this.conn.end();
  }

  handleError(error) {
    console.error(error);
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



  // async init() {
  //   try {
  //     await this.defaultConnect();
  //     await this.getGatewayInfo();
  //     try {
  //     } catch (error) {
  //       this.handleError(error)
  //     }
  //   } catch (error) {
  //     this.handleError(error)
  //   }
  // }
}

module.exports = {
  GatewayConnector
}
