import { WebSocketConnector } from './websocket_connector';
import { GatewayConnector } from './gateway_connector';
import https from 'https';
import fs from 'fs';
import { Logger } from './logger';
import { FlashGatewayConfig } from './interfaces/flash_gateway_config';
import { exec } from "child_process";

export class MainClass {
  private logger: any;
  private gatewayConnector: any;
  constructor() {
    this.logger = (new Logger()).createLogger()
  }

  async connectSSH(successCallback: () => void, errorCallback: () => void) {
    this.gatewayConnector = new GatewayConnector('172.16.0.1', 'root', 'eurotech');
    try {
      await this.gatewayConnector.createNewKey();
    } catch (error) {
      this.logger.error("Error creating rsa key: ", error);
      return false;
    }
    const onError = () => {
      errorCallback.call(this)
      setTimeout(() => {
        this.logger.info('SSH connection failed, reconnecting...')
        this.connectSSH(successCallback, errorCallback);
      }, 5000)
    }
    const onSuccess = () => {
      successCallback.call(this)
    }
    await this.gatewayConnector.connect({ onSuccess, onConnectionClose: onError, onError: onError })
  }

  downloadFile(url: string, options: any, downloadIfAlreadyExists = false) {
    return new Promise((resolve, reject) => {
      const {
        folder = './',
        fileName = url.substring(url.lastIndexOf('/') + 1),
      } = options;
      const filePath = `${folder}/${fileName}`;
      if (!downloadIfAlreadyExists && fs.existsSync(filePath)) {
        this.logger.info(`${filePath} already exists`)
        resolve(filePath);
      } else {
        if (!fs.existsSync(folder)) {
          fs.mkdirSync(filePath);
        }
        const file = fs.createWriteStream(filePath);
        https.get(url, response => {
          response.pipe(file);
          resolve(filePath);
          this.logger.info(`Downloaded ${url}`)
        }).on('error', error => {
          reject(error)
        });
      }
    })
  }

  async flashGateway(config: FlashGatewayConfig) {
    try {
      const snapshotPath = await this.downloadFile(config.snapshotUrl, { folder: './snapshots' })
      const esfPath = await this.downloadFile(config.esfRpmUrl, { folder: './esf' })
      const packagesPaths = await Promise.all(config.packages.map(packageUrl => {
        return this.downloadFile(packageUrl, { folder: './packages' });
      }))
      await this.gatewayConnector.installEsf(esfPath, snapshotPath, packagesPaths)
    } catch (error) {
      this.logger.error(error)
    }
  }

  getSerial(): Promise<string> {
    return new Promise((resolve, reject) => {
      exec("cat /proc/cpuinfo | grep Serial | cut -d ' ' -f 2", (error, stdout, stderr) => {
        if (error) {
          reject(error.message)
          return;
        }
        if (stderr) {
          reject(stderr)
        }
        resolve(stdout.trim());
      })
    })
  }

  async init() {
    // Connect to web socket
    // TODO: connect only after ssh connection
    const serial = await this.getSerial();
    const wsc = new WebSocketConnector(serial)
    wsc.connect();

    // Connect to gateway via SSH
    this.connectSSH(async () => {
      const gatewayInfo = await this.gatewayConnector.getGatewayInfo();
      wsc.sendInfoData(gatewayInfo)
    }, () => {
      wsc.sendInfoData();
    })

    // Listen for backend flashGatewayRequest and inform gateway connector
    wsc.eventEmitter.on('flashGatewayRequest', async (config: FlashGatewayConfig) => {
      this.logger.info('flashGatewayRequest event received')
      try {
        this.flashGateway(config);
      } catch (error) {
        this.logger.error(error)
      }
    })
    this.gatewayConnector.eventEmitter.on('flashGatewayUpdate', (data: any) => {
      wsc.sendFlashingUpdate(data);
    })
  }
}
