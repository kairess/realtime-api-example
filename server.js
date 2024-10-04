import { RealtimeClient } from '@openai/realtime-api-beta';
import mic from 'mic';
import dotenv from "dotenv";
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import wav from 'wav';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Realtime API 클라이언트 생성
const client = new RealtimeClient({ apiKey: process.env.OPENAI_API_KEY });

// 마이크 설정
const micInstance = mic({
  rate: '24000',
  channels: '1',
  fileType: 'wav'
});

const micInputStream = micInstance.getAudioStream();

// 이벤트 핸들러 설정
let audioBuffer = Buffer.alloc(0);
let currentText = '';

client.on('conversation.updated', (event) => {
  const { item, delta } = event;
  if (item.type === 'message' && item.role === 'assistant') {
    if (delta && delta.audio) {
      audioBuffer = Buffer.concat([audioBuffer, Buffer.from(delta.audio.buffer)]);
    }
    if (delta && delta.text) {
      currentText += delta.text;
      console.log('Assistant:', delta.text);
      io.emit('text', delta.text);
    }
  }
});

client.on('conversation.item.completed', ({ item }) => {
  if (item.type === 'message' && item.role === 'assistant') {
    if (audioBuffer.length > 0) {
      const wavWriter = new wav.Writer({
        channels: 1,
        sampleRate: 24000,
        bitDepth: 16
      });
      
      wavWriter.write(audioBuffer);
      wavWriter.end();
      
      const wavBuffer = wavWriter.read();
      
      io.emit('audio', wavBuffer);
      
      // 버퍼 초기화
      audioBuffer = Buffer.alloc(0);
    }
    
    // 전체 텍스트 전송 (옵션)
    io.emit('full_text', currentText);
    currentText = '';
  }
});

// API 연결
async function startConversation() {
  await client.connect();
  
  client.updateSession({
    instructions: '너는 나의 연인이야. 나와의 대화를 주의 깊게 듣고 대화를 친근한 반말로 이어가줘.',
    voice: 'alloy', // alloy, echo, fable, onyx, nova, and shimmer
    turn_detection: { type: 'none' }, // server_vad, none
    input_audio_transcription: { model: 'whisper-1' }
  });

  console.log('대화를 시작합니다. 말씀해 주세요.');
  micInstance.start();
}

// 오디오 스트림 처리
micInputStream.on('data', (data) => {
  if (client.isConnected()) {
    client.appendInputAudio(new Int16Array(data.buffer));
  }
});

client.on('error', (event) => {
  console.error('Error:', event);
});

app.use(express.static('public'));

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});

// Socket.io 연결 처리
io.on('connection', (socket) => {
  console.log('A user connected');
  
  socket.on('start_conversation', () => {
    startConversation();
  });
  
  socket.on('disconnect', () => {
    client.disconnect();
    console.log('User disconnected');
  });
});
