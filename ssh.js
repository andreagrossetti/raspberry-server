const fs = require('fs')
const path = require('path')
const node_ssh = require('node-ssh')
const ssh = new node_ssh()

ssh.connect({
  host: '172.168.0.1',
  username: 'root',
  privateKey: 'password'
})