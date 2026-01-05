import React, { useEffect, useRef } from 'react';

interface WaveformProps {
  stream: MediaStream | null;
  isRecording: boolean;
}

export const Waveform: React.FC<WaveformProps> = ({ stream, isRecording }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || !isRecording || !canvasRef.current) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const audioCtx = audioContextRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    // Set up audio nodes
    analyserRef.current = audioCtx.createAnalyser();
    analyserRef.current.fftSize = 256;
    sourceRef.current = audioCtx.createMediaStreamSource(stream);
    sourceRef.current.connect(analyserRef.current);

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isRecording) return;
      
      animationFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current!.getByteFrequencyData(dataArray);

      // Clear canvas
      ctx.fillStyle = 'rgb(249, 250, 251)'; // bg-gray-50
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2; // Scale down
        
        // Gradient color based on height
        const r = barHeight + 25 * (i / bufferLength);
        const g = 250 * (i / bufferLength);
        const b = 50;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        // Center the bars vertically
        ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      // We don't close AudioContext here to reuse it, but strict cleanup would close it.
    };
  }, [stream, isRecording]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={60} 
      className="rounded-lg border border-gray-200 shadow-sm"
    />
  );
};