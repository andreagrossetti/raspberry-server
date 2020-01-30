const { Socket } = require('phoenix-channels')

const webSocketConnect = () => {
  let socket = new Socket("ws://localhost:4001/socket")
  socket.connect()

  const serial = '00000000053c5b2a'

  let channel = socket.channel(`serial:${serial}`)
  channel.join()
    .receive("ok", resp => { console.log("Joined successfully", resp) })
    .receive("error", resp => { console.log("Unable to join", resp) })

  channel.on("new_msg", payload => {
    console.log('new msg');
    console.log(payload);
  })
}
