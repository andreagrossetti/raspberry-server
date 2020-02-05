const { WebSocketConnector } = require('./websocket_connector');
const { GatewayConnector } = require('./gateway_connector');
const https = require('https');
const fs = require('fs');
const { Client } = require('ssh2');
const { readFileSync } = require('fs')

const connectSSH = async (successCallback, errorCallback) => {
  this.gatewayConnector = new GatewayConnector();
  try {
    await this.gatewayConnector.createNewKey();
  } catch (error) {
    console.error("Error creating rsa key: ", error);
    return false;
  }
  const onError = () => {
    errorCallback.call()
    setTimeout(() => {
      console.log('SSH connection failed, reconnecting...')
      connectSSH(successCallback, errorCallback);
    }, 5000)
  }
  const onSuccess = () => {
    successCallback.call()
  }
  await this.gatewayConnector.connect('172.16.0.1', 'root', 'eurotech', { onSuccess, onConnectionClose: onError, onError: onError })
}

const downloadFile = (url, options) => {
  return new Promise((resolve, reject) => {
    const {
      folder = './',
      fileName = url.substring(url.lastIndexOf('/') + 1),
      downloadIfAlreadyExists = false
    } = options;
    const filePath = `${folder}/${fileName}`;
    if (!downloadIfAlreadyExists && fs.existsSync(filePath)) {
      console.log(`${filePath} already exists`)
      resolve(filePath);
    } else {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(filePath);
      }
      const file = fs.createWriteStream(filePath);
      https.get(url, response => {
        response.pipe(file);
        resolve(filePath);
        console.log(`Downloaded ${url}`)
      }).on('error', error => {
        reject(error)
      });
    }
  })
}

const flashGateway = async (esfRpmUrl = 'esf-reliagate-20-25-6.1.0-1.corei7_64.rpm', snapshotUrl = 'https://visup-misc.s3-eu-west-1.amazonaws.com/friulinox-snapshots/AB02.xml', packages = []) => {
  try {
    const snapshotPath = await downloadFile(snapshotUrl, { folder: './snapshots' })
    const esfPath = await downloadFile(esfRpmUrl, { folder: './esf' })
    const packagesPaths = await Promise.all(packages.map(packageUrl => {
      return downloadFile(packageUrl, { folder: './packages' });
    }))
    await this.gatewayConnector.installEsf(esfPath, snapshotPath, packagesPaths)
  } catch (error) {
    console.error(error)
  }
}

const init = async () => {
  // Connect to web socket
  // TODO: connect only after ssh connection
  const wsc = new WebSocketConnector
  await wsc.connect();

  // Connect to gateway via SSH
  connectSSH(async () => {
    const gatewayInfo = await this.gatewayConnector.getGatewayInfo();
    wsc.sendInfoData(gatewayInfo)
  }, () => {
    wsc.sendInfoData();
  })

  // Listen for backend flashGatewayRequest and inform gateway connector
  wsc.eventEmitter.on('flashGatewayRequest', async ({ esfRpmUrl, snapshotUrl, packages }) => {
    console.log('flashGatewayRequest event received')
    try {
      flashGateway(esfRpmUrl, snapshotUrl, packages);
    } catch (error) {
      console.error(error)
    }
  })

}

init();

