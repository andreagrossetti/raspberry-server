import { Socket, Channel } from 'phoenix-channels';
import { EventEmitter } from 'events';
import { Logger } from './logger';
import { FlashGatewayConfig } from './interfaces/flash_gateway_config';

export class WebSocketConnector extends EventEmitter {
  private VISUP_CLOUD_HOST = '192.168.178.148:4001';
  public eventEmitter: EventEmitter;
  private logger: any
  private serial: string;
  private socket: Socket;
  private channel: Channel;

  constructor(serial: string) {
    super();
    this.serial = serial;
    this.eventEmitter = new EventEmitter();
    this.logger = (new Logger()).createLogger()
    this.socket = new Socket(`ws://${this.VISUP_CLOUD_HOST}/socket`);
    this.channel = this.socket.channel(`serial:${this.serial}`)
  }

  emitFlashGatewayEvent(config: FlashGatewayConfig) {
    this.eventEmitter.emit('flashGatewayRequest', config)
  }

  async sendInfoData(body = null) {
    try {
      await this.channel.push('gateway_info', { body: body })
    } catch (error) {
      this.logger.error(error);
    }
  }

  async sendFlashingUpdate(data: any) {
    try {
      await this.channel.push('flashing_update', { body: data })
    } catch (error) {
      this.logger.error(error);
    }
  }

  connect() {
    this.socket.connect()
    this.channel.join()
      .receive("ok", (resp: any) => { this.logger.info("Joined successfully", resp) })
      .receive("error", (resp: any) => { this.logger.info("Unable to join", resp) })

    this.channel.on("new_msg", (payload: any) => {
      this.logger.info('new msg', payload);
    })
    this.channel.on("flash_gateway", (payload: any) => {
      // TODO: try catch
      this.emitFlashGatewayEvent({
        snapshotUrl: payload.snapshot_url,
        esfRpmUrl: payload.esf_rpm_url,
        packages: payload.packages
      })
    })
  }
}

