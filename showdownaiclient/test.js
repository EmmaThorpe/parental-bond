const WebSocket = require('ws');

const url = 'wss://sim3.psim.us/showdown/websocket'; // Replace with your WebSocket URL
const ws = new WebSocket(url);

ws.on('open', function open() {
    console.log('Connected to the WebSocket server.');
    ws.send('Hello Server!');
});

ws.on('message', function incoming(data) {
    console.log('Received message:', data);
});

ws.on('error', function error(err) {
    console.error('WebSocket error:', err);
});

ws.on('close', function close() {
    console.log('Connection closed.');
});