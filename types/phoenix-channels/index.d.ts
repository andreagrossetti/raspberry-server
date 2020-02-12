declare module 'phoenix-channels' {
  class Channel {
    constructor(topic: string, params: any, socket: Socket)
    join(): any;
    push(event: string, payload: any, timeout?: number): void;
    on(event: string, callback: (...params: any[]) => void): void
  }
  class Socket {
    constructor(endpoint: string)
    connect(): any;
    channel(topic: string, chanParams?: any): Channel
  }
}
