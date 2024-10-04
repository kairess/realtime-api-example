import { RealtimeClient } from '@openai/realtime-api-beta';
import mic from 'mic';
import APlay from 'aplay';
import dotenv from "dotenv";
import fs from 'fs';
import wav from 'node-wav';
import chalk from 'chalk';

dotenv.config();

// Realtime API 클라이언트 생성
const client = new RealtimeClient({ apiKey: process.env.OPENAI_API_KEY });

// 마이크 설정
const micInstance = mic({
  rate: '24000',
  channels: '1',
  fileType: 'wav'
});

const micInputStream = micInstance.getAudioStream();

// 임시 파일 경로
const tempAudioFile = './temp_audio.wav';

// WAV 파일 헤더 생성 함수
function createWavHeader(sampleRate, bitsPerSample, channels, dataLength) {
  const buffer = Buffer.alloc(44);
  
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  buffer.writeUInt16LE(channels * bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

// 이벤트 핸들러 설정
client.on('conversation.item.completed', (event) => {
  const { item } = event;
  if (item.type === 'message' && item.role === 'assistant') {
    console.log('Alloy:', item.formatted.transcript);
    
    if (item.formatted.audio && item.formatted.audio.length > 0) {
      // Int16Array를 Buffer로 변환
      const audioBuffer = Buffer.from(item.formatted.audio.buffer);
      
      // WAV 헤더 생성
      const wavHeader = createWavHeader(24000, 16, 1, audioBuffer.length);
      
      // WAV 파일 생성
      const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);
      fs.writeFileSync(tempAudioFile, wavBuffer);

      // WAV 파일 분석
      const wavFile = wav.decode(wavBuffer);
      const audioData = wavFile.channelData[0];
      
      let currentSample = 0;
      let updateInterval;
      
      const clearProgressBar = () => {
        process.stdout.write('\r' + ' '.repeat(process.stdout.columns) + '\r');
      };

      updateInterval = setInterval(() => {
        const chunkSize = 1000; // 업데이트 간격당 샘플 수
        const chunk = audioData.slice(currentSample, currentSample + chunkSize);
        const volume = Math.abs(chunk.reduce((sum, val) => sum + val, 0) / chunk.length);

        const barLength = Math.floor(volume * 10000);
        const bar = chalk.magenta('='.repeat(barLength)).padEnd(process.stdout.columns - 2, ' ');
        process.stdout.write(`\r[${bar}]`);

        currentSample += chunkSize;
        if (currentSample >= audioData.length) {
          clearInterval(updateInterval);
          clearProgressBar();
        }
      }, 50); // 50ms마다 업데이트

      // 오디오 재생 및 시각화
      const player = new APlay();
      player.play(tempAudioFile);
      
      // 재생 완료 후 임시 파일 삭제
      player.on('complete', () => {
        try {
          fs.unlinkSync(tempAudioFile);
        } catch (error) {
          console.error('임시 파일 삭제 중 오류 발생:', error);
        }
        clearInterval(updateInterval);
        clearProgressBar();
      });
    }
  }
});

client.on('error', (error) => {
  console.error('오류 발생:', error);
});

// API 연결
async function startConversation() {
  await client.connect();

  client.updateSession({
    instructions: '너는 나의 연인이야. 나와의 대화를 주의 깊게 듣고 대화를 친근한 반말로 이어가줘.',
    voice: 'alloy', // alloy, echo, fable, onyx, nova, and shimmer
    turn_detection: { type: 'server_vad' }, // server_vad, none
    input_audio_transcription: { model: 'whisper-1' }
  });

  console.log(chalk.cyan(`
  ╔════════════════════════════════════════════╗
  ║                                            ║
  ║   ${chalk.yellow('🎙️  Alloy와의 대화를 시작합니다  🎙️')}      ║
  ║                                            ║
  ║   ${chalk.blue('반갑게 인사를 건네보세요!')}                ║
  ║                                            ║
  ╚════════════════════════════════════════════╝
  `));
  micInstance.start();
}

// 오디오 스트림 처리
micInputStream.on('data', (data) => {
  client.appendInputAudio(new Int16Array(data.buffer));
});

startConversation();
