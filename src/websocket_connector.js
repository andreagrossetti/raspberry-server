const { Socket } = require('phoenix-channels')
const { exec } = require("child_process");
const EventEmitter = require('events');
const VISUP_CLOUD_HOST = '192.168.43.189:4001';
const { getLogger } = require('./logger');

class WebSocketConnector extends EventEmitter {
  constructor() {
    super();
    this.channel = undefined;
    this.eventEmitter = new EventEmitter();
    // setTimeout(() => {
    //   getLogger().info('emitting')
    //   this.emitFlashGatewayEvent();
    // }, 5000)
  }

  getSerial() {
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

  emitFlashGatewayEvent({ esfRpmUrl, snapshotUrl, packages }) {
    this.eventEmitter.emit('flashGatewayRequest', { esfRpmUrl, snapshotUrl, packages })
  }

  async sendInfoData(body = null) {
    try {
      await this.channel.push('gateway_info', { body: body })
    } catch (error) {
      getLogger().error(error);
    }
  }

  async connect() {
    const serial = await this.getSerial()
    let socket = new Socket(`ws://${VISUP_CLOUD_HOST}/socket`)
    socket.connect()

    let channel = socket.channel(`serial:${serial}`)
    channel.join()
      .receive("ok", resp => { getLogger().info("Joined successfully", resp) })
      .receive("error", resp => { getLogger().info("Unable to join", resp) })

    channel.on("new_msg", payload => {
      getLogger().info('new msg', payload);
    })
    channel.on("flash_gateway", payload => {
      // TODO: try catch
      this.emitFlashGatewayEvent({
        snapshotUrl: payload.snapshot_url,
        esfRpmUrl: payload.esf_rpm_url,
        packages: payload.packages
      })
    })
    this.channel = channel;
  }
}

module.exports = {
  WebSocketConnector
}
