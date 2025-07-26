'use client'
import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';


/**
 * LiveCommentsOverlay - Complete Demo Implementation in React TypeScript
 * Combines the original component with a fully functional demo interface
 * 
 * Features:
 * - Complete LiveCommentsOverlay React component
 * - Interactive demo interface  
 * - Mock WebSocket server for testing
 * - Real-time comment simulation
 * - Admin controls and moderation
 * - Error handling and validation
 * - GDPR compliance and accessibility
 */


// =====================================================
// TYPE DEFINITIONS
// =====================================================


interface Comment {
  id: string;
  username: string;
  text: string;
  timestamp: string;
  highlighted?: boolean;
  status?: 'normal' | 'quarantined';
  type?: string;
}


interface LiveCommentsConfig {
  backend?: 'websocket' | 'firebase';
  websocketUrl?: string;
  firebaseConfig?: any;
  moderationEnabled?: boolean;
  maxCommentsVisible?: number;
  commentDisplayDuration?: number;
  profanityFilter?: boolean;
  userRole?: 'user' | 'admin';
  gdprCompliance?: boolean;
  theme?: 'default' | 'dark' | 'light';
  onCommentReceived?: (comment: Comment) => void;
  onCommentFiltered?: (comment: Comment) => void;
  onModerationAction?: (commentId: string, action: string) => void;
  onWebSocketConnect?: () => void;
  onWebSocketDisconnect?: () => void;
  onError?: (errorInfo: { message: string; error: string; timestamp: string }) => void;
}


interface LiveCommentsOverlayProps {
  config: LiveCommentsConfig;
  playerElement?: HTMLElement | null;
  className?: string;
}


interface LiveCommentsOverlayRef {
  sendComment: (message: string) => void;
  moderateComment: (commentId: string, action: 'highlight' | 'quarantine' | 'delete') => void;
  getComments: () => Comment[];
  getModerationQueue: () => Comment[];
  simulateComment: (comment: Comment) => void;
  destroy: () => void;
}


interface DemoStats {
  comments: number;
  errors: number;
  isConnected: boolean;
  moderationQueue: number;
}


// =====================================================
// MOCK WEBSOCKET IMPLEMENTATION FOR DEMO
// =====================================================


class MockWebSocketServer {
  private readonly clients: MockWebSocket[] = [];
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;


  start() {
    this.isRunning = true;
    console.log('🚀 Mock WebSocket server started');
    
    // Simulate incoming messages every few seconds
    this.intervalId = setInterval(() => {
      if (this.clients.length > 0) {
        this.broadcastRandomMessage();
      }
    }, 3000);
  }


  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }


  addClient(client: MockWebSocket) {
    this.clients.push(client);
    console.log('🔗 Client connected to mock server');
  }


  removeClient(client: MockWebSocket) {
    const index = this.clients.indexOf(client);
    if (index > -1) {
      this.clients.splice(index, 1);
      console.log('🔌 Client disconnected from mock server');
    }
  }


  broadcastRandomMessage() {
    const sampleMessages = [
      "Great video! 🎉",
      "Thanks for sharing this!",
      "Very informative 👍",
      "Love this content",
      "Keep up the good work!",
      "Amazing explanation!",
      "This is so helpful",
      "Subscribed! 🔔",
      "More videos like this please",
      "Best tutorial ever! ⭐"
    ];


    const usernames = [
      "VideoFan123", "TechLover", "StudentLife", "CodeNinja", 
      "WebDev2024", "LearnMore", "StreamWatcher", "DevGuru"
    ];


    const message = {
      id: 'demo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      username: usernames[Math.floor(Math.random() * usernames.length)],
      text: sampleMessages[Math.floor(Math.random() * sampleMessages.length)],
      timestamp: new Date().toISOString(),
      type: 'comment'
    };


    // Send to all connected clients
    this.clients.forEach(client => {
      if (client.onmessage) {
        client.onmessage({ data: JSON.stringify(message) } as MessageEvent);
      }
    });
  }
}


class MockWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;


  public readyState: number = MockWebSocket.CONNECTING;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;


  constructor(public url: string) {
    // Simulate connection delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
      
      // Register with mock server
      if ((globalThis as any).mockServer) {
        (globalThis as any).mockServer.addClient(this);
      }
    }, 500);
  }


  send(data: string) {
    try {
      const message = JSON.parse(data);
      console.log('📤 Sent message:', message);
      
      // Echo the message back as if it came from the server
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({ data: data } as MessageEvent);
        }
      }, 100);
    } catch (error) {
      console.error('❌ Error sending message:', error);
    }
  }


  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if ((globalThis as any).mockServer) {
      (globalThis as any).mockServer.removeClient(this);
    }
    if (this.onclose) {
      this.onclose({ code, reason } as CloseEvent);
    }
  }
}


// =====================================================
// LIVE COMMENTS OVERLAY COMPONENT
// =====================================================


const LiveCommentsOverlay = forwardRef<LiveCommentsOverlayRef, LiveCommentsOverlayProps>(
  ({ config, className = '' }, ref) => {
    const [comments, setComments] = useState<Comment[]>([]);
    const [moderationQueue, setModerationQueue] = useState<Comment[]>([]);
    const [userConsent, setUserConsent] = useState<boolean>(false);
    const [showConsentBanner, setShowConsentBanner] = useState<boolean>(false);
    const [inputValue, setInputValue] = useState<string>('');
    const [isConnected, setIsConnected] = useState<boolean>(false);

    const websocketRef = useRef<WebSocket | MockWebSocket | null>(null);
    const reconnectAttemptsRef = useRef<number>(0);
    const rateLimitMapRef = useRef<Map<string, number>>(new Map());


    const bannedWords = ['spam', 'offensive', 'inappropriate'];
    const maxReconnectAttempts = 5;


    // Default configuration with validation
    const validateConfig = (inputConfig: LiveCommentsConfig): Required<LiveCommentsConfig> => {
      return {
        backend: inputConfig.backend || 'websocket',
        websocketUrl: inputConfig.websocketUrl || 'ws://localhost:8080',
        firebaseConfig: inputConfig.firebaseConfig || null,
        moderationEnabled: inputConfig.moderationEnabled !== false,
        maxCommentsVisible: Math.min(Math.max(inputConfig.maxCommentsVisible || 50, 1), 200),
        commentDisplayDuration: Math.min(Math.max(inputConfig.commentDisplayDuration || 5000, 1000), 30000),
        profanityFilter: inputConfig.profanityFilter !== false,
        userRole: ['user', 'admin'].includes(inputConfig.userRole || 'user') ? (inputConfig.userRole || 'user') : 'user',
        gdprCompliance: inputConfig.gdprCompliance !== false,
        theme: ['default', 'dark', 'light'].includes(inputConfig.theme || 'default') ? (inputConfig.theme || 'default') : 'default',
        onCommentReceived: inputConfig.onCommentReceived || (() => {}),
        onCommentFiltered: inputConfig.onCommentFiltered || (() => {}),
        onModerationAction: inputConfig.onModerationAction || (() => {}),
        onWebSocketConnect: inputConfig.onWebSocketConnect || (() => {}),
        onWebSocketDisconnect: inputConfig.onWebSocketDisconnect || (() => {}),
        onError: inputConfig.onError || ((_: { message: string; error: string; timestamp: string }) => {}),
      };
    };


    const validatedConfig = validateConfig(config);
    const isAdmin = validatedConfig.userRole === 'admin';


    // Error handling
    const handleError = useCallback((message: string, error: unknown) => {
      console.error(`❌ LiveCommentsOverlay Error: ${message}`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      validatedConfig.onError({ message, error: errorMessage, timestamp: new Date().toISOString() });
    }, [validatedConfig]);


    // Utility functions
    const generateId = (): string => {
      return 'comment_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
    };


    const sanitizeHtml = (text: string): string => {
      try {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      } catch (error) {
        handleError('HTML sanitization failed', error);
        return '';
      }
    };


    const containsProfanity = (text: string): boolean => {
      try {
        const lowerText = text.toLowerCase();
        return bannedWords.some(word => lowerText.includes(word));
      } catch (error) {
        handleError('Profanity check failed', error);
        return true; // Fail safe
      }
    };


    const checkRateLimit = (): boolean => {
      try {
        const now = Date.now();
        const lastComment = rateLimitMapRef.current.get('lastComment') || 0;
        
        if (now - lastComment < 2000) {
          return false;
        }
        
        rateLimitMapRef.current.set('lastComment', now);
        return true;
      } catch (error) {
        handleError('Rate limit check failed', error);
        return false;
      }
    };


    // Initialize component
    useEffect(() => {
      try {
        if (validatedConfig.gdprCompliance) {
          const consent = localStorage.getItem('commentsConsent');
          if (consent === 'granted') {
            setUserConsent(true);
          } else {
            setShowConsentBanner(true);
          }
        } else {
          setUserConsent(true);
        }
      } catch (error) {
        handleError('Initialization failed', error);
      }
    }, [validatedConfig.gdprCompliance, handleError]);


    // Connect to backend when consent is granted
    useEffect(() => {
      if (userConsent) {
        connectToBackend();
      }
      return () => {
        if (websocketRef.current) {
          websocketRef.current.close();
        }
      };
    }, [userConsent]);


    // Keyboard navigation support
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        try {
          if (e.altKey && e.key === 'c') {
            const input = document.querySelector('.comments-input') as HTMLInputElement;
            if (input) input.focus();
          }
        } catch (error) {
          handleError('Keyboard navigation failed', error);
        }
      };


      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleError]);


    const connectToBackend = () => {
      try {
        if (validatedConfig.backend === 'firebase' && validatedConfig.firebaseConfig) {
          console.log('🔥 Firebase integration not implemented in this demo');
          handleError('Firebase not implemented', new Error('Firebase backend not available'));
        } else {
          connectToWebSocket();
        }
      } catch (error) {
        handleError('Backend connection failed', error);
      }
    };


    const connectToWebSocket = () => {
      try {
        // Use MockWebSocket for demo
        websocketRef.current = new MockWebSocket(validatedConfig.websocketUrl);
        
        websocketRef.current.onopen = () => {
          console.log('🔗 Connected to WebSocket server');
          setIsConnected(true);
          reconnectAttemptsRef.current = 0;
          validatedConfig.onWebSocketConnect();
        };
        
        websocketRef.current.onmessage = (event) => {
          handleWebSocketMessage(event);
        };
        
        websocketRef.current.onclose = (event) => {
          console.log('🔌 WebSocket connection closed');
          setIsConnected(false);
          validatedConfig.onWebSocketDisconnect();
          if (event.code !== 1000 && event.code !== 1001) {
            attemptReconnect();
          }
        };
        
        websocketRef.current.onerror = (error) => {
          handleError('WebSocket error', error);
        };
      } catch (error) {
        handleError('WebSocket connection failed', error);
      }
    };

    const handleWebSocketMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as Comment;
        if (validateIncomingMessage(data)) {
          handleIncomingComment(data);
        }
      } catch (error) {
        handleError('Message parsing failed', error);
      }
    };


    const validateIncomingMessage = (data: any): boolean => {
      return data && 
             typeof data.id === 'string' && 
             typeof data.username === 'string' && 
             typeof data.text === 'string' && 
             typeof data.timestamp === 'string';
    };


    const attemptReconnect = () => {
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        
        setTimeout(() => {
          console.log(`🔄 Reconnection attempt ${reconnectAttemptsRef.current}`);
          connectToWebSocket();
        }, delay);
      } else {
        handleError('Max reconnection attempts reached', new Error('Unable to reconnect'));
      }
    };

    const handleIncomingComment = (data: Comment) => {
      try {
        validatedConfig.onCommentReceived(data);


        if (validatedConfig.profanityFilter && containsProfanity(data.text)) {
          validatedConfig.onCommentFiltered(data);
          
          if (validatedConfig.moderationEnabled) {
            const quarantinedComment: Comment = { ...data, status: 'quarantined' };
            
            setModerationQueue(prev => [...prev, quarantinedComment]);
            
            if (isAdmin) {
              displayComment(quarantinedComment);
            }
          }
          return;
        }


        displayComment(data);
      } catch (error) {
        handleError('Incoming comment handling failed', error);
      }
    };


    const displayComment = (comment: Comment) => {
      try {
        setComments(prev => {
          const newComments = [...prev, comment];
          return newComments.slice(-validatedConfig.maxCommentsVisible);
        });


        // Auto-remove comment after display duration
        setTimeout(() => {
          setComments(prev => prev.filter(c => c.id !== comment.id));
        }, validatedConfig.commentDisplayDuration);
      } catch (error) {
        handleError('Comment display failed', error);
      }
    };


    const sendComment = useCallback((message: string) => {
      try {
        if (!userConsent && validatedConfig.gdprCompliance) {
          throw new Error('User consent required');
        }


        if (!message || typeof message !== 'string' || !message.trim()) {
          throw new Error('Invalid message');
        }


        if (message.length > 200) {
          throw new Error('Message too long');
        }


        if (!checkRateLimit()) {
          throw new Error('Rate limit exceeded');
        }


        const comment: Comment = {
          id: generateId(),
          username: 'User' + Math.floor(Math.random() * 1000),
          text: message.trim(),
          timestamp: new Date().toISOString()
        };


        if (websocketRef.current && websocketRef.current.readyState === MockWebSocket.OPEN) {
          websocketRef.current.send(JSON.stringify(comment));
        } else {
          throw new Error('Not connected to server');
        }
      } catch (error) {
        handleError('Send comment failed', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        alert(`Send failed: ${errorMessage}`);
      }
    }, [userConsent, validatedConfig.gdprCompliance, handleError]);

    const processCommentModeration = (comment: Comment, action: 'highlight' | 'quarantine' | 'delete'): Comment | null => {
      switch (action) {
        case 'highlight':
          return { ...comment, highlighted: true };
        case 'quarantine':
          return { ...comment, status: 'quarantined' };
        case 'delete':
          return null;
        default:
          return comment;
      }
    };

    const moderateComment = useCallback((commentId: string, action: 'highlight' | 'quarantine' | 'delete') => {
      try {
        if (!commentId || !['highlight', 'quarantine', 'delete'].includes(action)) {
          throw new Error('Invalid moderation parameters');
        }


        validatedConfig.onModerationAction(commentId, action);
        
        setComments(prev => {
          return prev.map(comment => {
            if (comment.id === commentId) {
              return processCommentModeration(comment, action);
            }
            return comment;
          }).filter(Boolean) as Comment[];
        });
      } catch (error) {
        handleError('Moderation failed', error);
      }
    }, [validatedConfig, handleError]);


    const simulateComment = useCallback((comment: Comment) => {
      try {
        if (!validateIncomingMessage(comment)) {
          throw new Error('Invalid comment format');
        }
        handleIncomingComment(comment);
      } catch (error) {
        handleError('Comment simulation failed', error);
      }
    }, [handleError]);


    const handleConsentAccept = () => {
      try {
        setUserConsent(true);
        localStorage.setItem('commentsConsent', 'granted');
        setShowConsentBanner(false);
      } catch (error) {
        handleError('Consent handling failed', error);
      }
    };


    const handleConsentDecline = () => {
      setUserConsent(false);
      setShowConsentBanner(false);
    };


    const handleInputSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && inputValue.trim()) {
        sendComment(inputValue.trim());
        setInputValue('');
      }
    };


    const destroy = useCallback(() => {
      try {
        if (websocketRef.current) {
          websocketRef.current.close();
        }
        
        if (validatedConfig.gdprCompliance) {
          localStorage.removeItem('commentsConsent');
        }
        
        setComments([]);
        setModerationQueue([]);
      } catch (error) {
        handleError('Cleanup failed', error);
      }
    }, [validatedConfig.gdprCompliance, handleError]);


    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      sendComment,
      moderateComment,
      getComments: () => comments,
      getModerationQueue: () => moderationQueue,
      simulateComment,
      destroy
    }));


    // Component styles
    const overlayStyles: React.CSSProperties = {
      position: 'absolute',
      top: '10px',
      right: '10px',
      width: '300px',
      maxHeight: '400px',
      background: 'rgba(0, 0, 0, 0.8)',
      borderRadius: '8px',
      padding: '10px',
      overflowY: 'auto',
      zIndex: 1000,
      color: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      lineHeight: 1.4
    };


    const inputContainerStyles: React.CSSProperties = {
      position: 'absolute',
      bottom: '10px',
      right: '10px',
      width: '300px'
    };


    const inputStyles: React.CSSProperties = {
      width: '100%',
      padding: '8px',
      border: 'none',
      borderRadius: '4px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#ffffff',
      fontSize: '14px'
    };


    // Sub-components
    const CommentItem: React.FC<{ comment: Comment }> = ({ comment }) => {
      const itemStyles: React.CSSProperties = {
        marginBottom: '8px',
        padding: '5px',
        borderLeft: `3px solid ${comment.highlighted ? '#ffd700' : comment.status === 'quarantined' ? '#dc3545' : '#007bff'}`,
        background: comment.highlighted ? 'rgba(255, 215, 0, 0.2)' : comment.status === 'quarantined' ? 'rgba(220, 53, 69, 0.2)' : 'rgba(255, 255, 255, 0.1)',
        borderRadius: '4px'
      };


      return (
        <article style={itemStyles} data-comment-id={comment.id}>
          <div style={{ fontWeight: 'bold', color: '#007bff', marginRight: '5px' }}>
            {sanitizeHtml(comment.username)}:
          </div>
          <div style={{ wordWrap: 'break-word' }}>
            {sanitizeHtml(comment.text)}
          </div>
          <div style={{ fontSize: '10px', color: '#cccccc', marginTop: '2px' }}>
            {new Date(comment.timestamp).toLocaleTimeString()}
          </div>
          {isAdmin && (
            <div style={{ marginTop: '5px' }}>
              <button
                style={{ background: 'none', border: '1px solid #ffffff', color: '#ffffff', padding: '2px 8px', marginRight: '5px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                onClick={() => moderateComment(comment.id, 'highlight')}
              >
                Highlight
              </button>
              <button
                style={{ background: 'none', border: '1px solid #ffffff', color: '#ffffff', padding: '2px 8px', marginRight: '5px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                onClick={() => moderateComment(comment.id, 'quarantine')}
              >
                Quarantine
              </button>
              <button
                style={{ background: 'none', border: '1px solid #ffffff', color: '#ffffff', padding: '2px 8px', marginRight: '5px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px' }}
                onClick={() => moderateComment(comment.id, 'delete')}
              >
                Delete
              </button>
            </div>
          )}
        </article>
      );
    };


    const ConsentBanner: React.FC = () => (
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#333',
        color: 'white',
        padding: '20px',
        zIndex: 10000
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <dialog open aria-labelledby="consent-title">
            <h3 id="consent-title">Cookie and Data Consent</h3>
            <p>
              We use cookies and store comment data to provide live chat functionality.
              Your data is processed according to GDPR regulations.
            </p>
            <button
              style={{ background: '#007bff', color: 'white', border: 'none', padding: '10px 20px', marginRight: '10px', borderRadius: '4px', cursor: 'pointer' }}
              onClick={handleConsentAccept}
            >
              Accept
            </button>
            <button
              style={{ background: '#6c757d', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}
              onClick={handleConsentDecline}
            >
              Decline
            </button>
          </dialog>
        </div>
      </div>
    );


    return (
      <>
        <div
          className={`live-comments-overlay ${className}`}
          style={overlayStyles}
          role="log"
          aria-live="polite"
          aria-label="Live comments stream"
        >
          {comments.map(comment => (
            <CommentItem key={comment.id} comment={comment} />
          ))}
        </div>


        <div style={inputContainerStyles}>
          <input
            style={inputStyles}
            className="comments-input"
            type="text"
            placeholder="Type a comment..."
            aria-label="Type a live comment"
            maxLength={200}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleInputSubmit}
          />
        </div>


        {showConsentBanner && <ConsentBanner />}
      </>
    );
  }
);


LiveCommentsOverlay.displayName = 'LiveCommentsOverlay';


// =====================================================
// DEMO PAGE COMPONENT
// =====================================================


const DemoPage: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [consoleLog, setConsoleLog] = useState<string[]>(['Demo starting...']);
  const [isAdminMode, setIsAdminMode] = useState(false);
  
  const overlayRef = useRef<LiveCommentsOverlayRef>(null);


  // Demo configuration
  const demoConfig: LiveCommentsConfig = {
    backend: 'websocket',
    websocketUrl: 'ws://localhost:8080',
    moderationEnabled: true,
    maxCommentsVisible: 10,
    commentDisplayDuration: 8000,
    profanityFilter: true,
    userRole: isAdminMode ? 'admin' : 'user',
    gdprCompliance: false, // Disabled for demo simplicity
    theme: 'default',
    onCommentReceived: (comment) => {
      logToConsole(`💬 Comment received: ${comment.text}`);
      setCommentCount(prev => prev + 1);
    },
    onWebSocketConnect: () => {
      setIsConnected(true);
      logToConsole('🔗 Connected to demo server');
    },
    onWebSocketDisconnect: () => {
      setIsConnected(false);
      logToConsole('🔌 Disconnected from server');
    },
    onError: (errorInfo: { message: string; error: string; timestamp: string }) => {
      logToConsole(`⚠️ Error: ${errorInfo.message}`);
      setErrorCount(prev => prev + 1);
    }
  };


  const logToConsole = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLog(prev => [...prev, `[${timestamp}] ${message}`].slice(-50));
  }, []);


  // Initialize demo
  useEffect(() => {
    // Initialize mock server
    const mockServer = new MockWebSocketServer();
    (globalThis as any).mockServer = mockServer;
    mockServer.start();


    // Setup demo
    setTimeout(() => {
      setIsLoading(false);
      logToConsole('✅ Demo initialized successfully!');
      logToConsole('💡 Try typing in the comment input or use the control buttons');
    }, 1000);


    return () => {
      mockServer.stop();
    };
  }, [logToConsole]);


  // Demo control functions
  const sendQuickComment = () => {
    const messages = [
      "This is awesome! 🎉",
      "Great demonstration!",
      "How does this work?",
      "Amazing features! 👏",
      "Very impressive system",
      "Love the real-time updates",
      "Professional quality! ⭐"
    ];
    
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    if (overlayRef.current) {
      overlayRef.current.simulateComment({
        id: 'quick_' + Date.now(),
        username: 'QuickTester',
        text: randomMessage,
        timestamp: new Date().toISOString()
      });
      logToConsole(`Sent: "${randomMessage}"`);
    }
  };


  const sendHighlightedComment = () => {
    if (overlayRef.current) {
      overlayRef.current.simulateComment({
        id: 'highlight_' + Date.now(),
        username: 'DemoModerator',
        text: '⭐ This is a highlighted comment from the demo!',
        timestamp: new Date().toISOString(),
        highlighted: true
      });
      logToConsole('Sent highlighted comment');
    }
  };


  const sendSpamComment = () => {
    if (overlayRef.current) {
      overlayRef.current.simulateComment({
        id: 'spam_' + Date.now(),
        username: 'SpamBot',
        text: 'This is spam content that should be filtered',
        timestamp: new Date().toISOString()
      });
      logToConsole('Sent spam comment (should be filtered)');
    }
  };


  const toggleAdminMode = () => {
    setIsAdminMode(prev => !prev);
    const message = !isAdminMode ? 
      'Admin mode enabled! Refresh to see admin controls.' :
      'Admin mode disabled.';
    logToConsole(message);
  };


  const clearComments = () => {
    setCommentCount(0);
    logToConsole('Comments cleared');
  };


  const showStats = () => {
    const stats = {
      comments: commentCount,
      errors: errorCount,
      connected: isConnected,
      moderationQueue: overlayRef.current?.getModerationQueue().length || 0
    };
    
    const statsMessage = `Statistics: Comments: ${stats.comments}, Errors: ${stats.errors}, Connected: ${stats.connected}, Queue: ${stats.moderationQueue}`;
    logToConsole(statsMessage);
    alert(statsMessage);
  };


  // Styles
  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
      background: 'white',
      borderRadius: '12px',
      overflow: 'hidden' as const,
      boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    },
    header: {
      background: 'linear-gradient(135deg, #007bff, #0056b3)',
      color: 'white',
      padding: '30px',
      textAlign: 'center' as const
    },
    content: {
      padding: '20px'
    },
    featureGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '20px',
      margin: '30px 0'
    },
    featureCard: {
      background: '#f8f9fa',
      padding: '20px',
      borderRadius: '8px',
      borderLeft: '4px solid #007bff'
    },
    demoControls: {
      background: '#e3f2fd',
      padding: '20px',
      borderRadius: '8px',
      margin: '20px 0',
      textAlign: 'center' as const
    },
    controlButtons: {
      display: 'flex',
      gap: '10px',
      justifyContent: 'center',
      flexWrap: 'wrap' as const,
      marginTop: '15px'
    },
    btn: {
      background: '#007bff',
      color: 'white',
      border: 'none',
      padding: '10px 20px',
      borderRadius: '5px',
      cursor: 'pointer',
      fontSize: '14px',
      transition: 'background 0.3s'
    },
    btnSecondary: {
      background: '#6c757d'
    },
    videoPlayer: {
      width: '100%',
      maxWidth: '800px',
      height: '450px',
      background: 'linear-gradient(45deg, #1e3c72, #2a5298)',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontSize: '24px',
      fontWeight: 'bold' as const,
      margin: '20px auto',
      position: 'relative' as const,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    },
    consoleOutput: {
      background: '#1e1e1e',
      color: '#f8f8f2',
      padding: '15px',
      borderRadius: '5px',
      fontFamily: 'monospace',
      fontSize: '12px',
      maxHeight: '200px',
      overflowY: 'auto' as const,
      margin: '20px 0',
      whiteSpace: 'pre-wrap' as const
    },
    statusBar: {
      background: '#f8f9fa',
      padding: '10px 20px',
      borderTop: '1px solid #dee2e6',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: '14px'
    },
    statusIndicator: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    statusDot: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: isConnected ? '#28a745' : '#dc3545',
      animation: 'pulse 2s infinite'
    },
    loading: {
      textAlign: 'center' as const,
      padding: '40px',
      color: '#6c757d'
    }
  };


  if (isLoading) {
    return (
      <div style={{ ...styles.container, minHeight: '50vh' }}>
        <div style={styles.loading}>
          <div style={{
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #007bff',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            animation: 'spin 1s linear infinite',
            margin: '20px auto'
          }} />
          <p>Initializing demo...</p>
        </div>
      </div>
    );
  }


  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={{ margin: '0', fontSize: '2.5em', fontWeight: 300 }}>🎬 LiveCommentsOverlay</h1>
        <p style={{ margin: '10px 0 0 0', opacity: 0.9, fontSize: '1.1em' }}>
          Interactive Demo - Real-time Video Comments System
        </p>
      </div>


      <div style={styles.content}>
        <div style={styles.featureGrid}>
          <div style={styles.featureCard}>
            <h3 style={{ marginTop: 0, color: '#007bff' }}>🚀 Real-time Comments</h3>
            <p>Live streaming comments with WebSocket support and auto-reconnection.</p>
          </div>
          <div style={styles.featureCard}>
            <h3 style={{ marginTop: 0, color: '#007bff' }}>🛡️ Content Moderation</h3>
            <p>Built-in profanity filtering and admin moderation controls.</p>
          </div>
          <div style={styles.featureCard}>
            <h3 style={{ marginTop: 0, color: '#007bff' }}>♿ Accessibility</h3>
            <p>WCAG 2.1 compliant with keyboard navigation and screen reader support.</p>
          </div>
          <div style={styles.featureCard}>
            <h3 style={{ marginTop: 0, color: '#007bff' }}>🔒 GDPR Compliance</h3>
            <p>User consent management and data privacy controls.</p>
          </div>
        </div>


        <div style={styles.demoControls}>
          <h3 style={{ marginTop: 0, color: '#0277bd' }}>🎮 Demo Controls</h3>
          <p>Use these controls to test different features of the comment system.</p>
          
          <div style={styles.controlButtons}>
            <button style={styles.btn} onClick={sendQuickComment}>
              Send Test Comment
            </button>
            <button style={styles.btn} onClick={sendHighlightedComment}>
              Send Highlighted Comment
            </button>
            <button style={styles.btn} onClick={sendSpamComment}>
              Test Spam Filter
            </button>
            <button style={styles.btn} onClick={toggleAdminMode}>
              Toggle Admin Mode {isAdminMode ? '(ON)' : '(OFF)'}
            </button>
            <button style={{...styles.btn, ...styles.btnSecondary}} onClick={clearComments}>
              Clear Comments
            </button>
            <button style={{...styles.btn, ...styles.btnSecondary}} onClick={showStats}>
              Show Statistics
            </button>
          </div>
        </div>


        {/* Demo Video Player with Overlay */}
        <div style={styles.videoPlayer}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>🎥</div>
            <div>Demo Video Player</div>
            <div style={{ fontSize: '14px', marginTop: '10px', opacity: 0.8 }}>
              Live Comments Overlay Demo
            </div>
          </div>
          
          {/* LiveCommentsOverlay Component */}
          <LiveCommentsOverlay
            ref={overlayRef}
            config={demoConfig}
          />
        </div>


        {/* Instructions */}
        <div style={{
          maxWidth: '800px',
          margin: '20px auto',
          padding: '20px',
          background: '#f8f9fa',
          borderRadius: '8px',
          borderLeft: '4px solid #007bff'
        }}>
          <h3 style={{ marginTop: 0, color: '#007bff' }}>🎮 Demo Instructions</h3>
          <ul style={{ lineHeight: 1.6 }}>
            <li><strong>Type comments:</strong> Use the input field in the bottom-right to send messages</li>
            <li><strong>Auto messages:</strong> The system generates demo messages every 3 seconds</li>
            <li><strong>Rate limiting:</strong> Wait 2 seconds between your own comments</li>
            <li><strong>Keyboard shortcut:</strong> Press Alt+C to focus the comment input</li>
            <li><strong>Admin mode:</strong> Toggle admin mode to see moderation controls</li>
          </ul>
          <div style={{ marginTop: '15px', padding: '10px', background: '#e3f2fd', borderRadius: '4px' }}>
            💡 <strong>Tip:</strong> All demo functionality works without a real server thanks to the mock WebSocket implementation
          </div>
        </div>


        {/* Console Output */}
        <div>
          <h4>📋 Console Output</h4>
          <div style={styles.consoleOutput}>
            {consoleLog.join('\n')}
          </div>
        </div>
      </div>


      {/* Status Bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusIndicator}>
          <div style={styles.statusDot} />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div>
          <span>Comments: {commentCount}</span> |{' '}
          <span>Errors: {errorCount}</span>
        </div>
      </div>


      <style jsx global>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        body {
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: #333;
        }
      `}</style>
    </div>
  );
};


export default DemoPage;
