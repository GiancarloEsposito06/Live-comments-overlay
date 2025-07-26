import React, { useRef } from 'react';
import LiveCommentsOverlay, { LiveCommentsOverlayRef } from './LiveCommentsOverlay';

const VideoPlayer: React.FC = () => {
  const overlayRef = useRef<LiveCommentsOverlayRef>(null);

  const handleSendComment = () => {
    overlayRef.current?.sendComment('Test comment');
  };

  return (
    <div style={{ position: 'relative' }}>
      <video controls width="800" height="450">
        <source src="video.mp4" type="video/mp4" />
      </video>
      
      <LiveCommentsOverlay
        ref={overlayRef}
        config={sampleConfig}
      />
      
      <button onClick={handleSendComment}>Send Test Comment</button>
    </div>
  );
};
