import React, { useState, useRef, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
import {
  Smartphone,
  QrCode,
  Link2,
  Copy,
  Check,
  Camera,
  Upload,
  X,
  ExternalLink,
  RefreshCw,
  Share2,
  MessageCircle,
  Settings,
  Clock,
  Phone,
  Crosshair,
  ScreenShare
} from 'lucide-react';
import './App.css';

function App() {
  const [lpaCode, setLpaCode] = useState('');
  const [smdpAddress, setSmdpAddress] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [scannerReady, setScannerReady] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const [scannerPaused, setScannerPaused] = useState(false);
  const [standbyPhone, setStandbyPhone] = useState('');
  const [standbyLink, setStandbyLink] = useState('');
  const [isCreatingStandby, setIsCreatingStandby] = useState(false);
  const [standbyError, setStandbyError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isDefaultPassword, setIsDefaultPassword] = useState(false);
  const [cutoutActive, setCutoutActive] = useState(false);
  const [cutoutStatus, setCutoutStatus] = useState('');
  const [cutoutPreview, setCutoutPreview] = useState('');
  const [parsedLpaData, setParsedLpaData] = useState(null); // Store parsed SMDP data for confirmation
  const [shortLink, setShortLink] = useState(''); // Short link for sharing
  const [isCreatingShortLink, setIsCreatingShortLink] = useState(false);
  const html5QrCodeRef = useRef(null);
  const scannerInitialized = useRef(false);
  const mediaStreamRef = useRef(null);

  // API Configuration
  const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api'
    : 'https://ezrefillny.net/api';

  // Create short link from LPA code
  const createShortLink = async (lpaCode) => {
    if (!lpaCode) return;
    setIsCreatingShortLink(true);
    setShortLink('');

    try {
      const response = await fetch(`${API_BASE}/shortlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lpaCode })
      });

      if (response.ok) {
        const data = await response.json();
        setShortLink(data.shortUrl);
      } else {
        console.error('Failed to create short link');
      }
    } catch (error) {
      console.error('Error creating short link:', error);
    } finally {
      setIsCreatingShortLink(false);
    }
  };

  // Check for saved authentication on mount
  useEffect(() => {
    const savedAuth = localStorage.getItem('ezrefill_webapp_auth');
    if (savedAuth === 'authenticated') {
      setIsAuthenticated(true);
    }
  }, []);

  // Login function - uses same credentials as admin panel
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: loginPassword })
      });

      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        localStorage.setItem('ezrefill_webapp_auth', 'authenticated');
        setLoginPassword('');
        // Check if using default password - prompt to change
        if (data.isDefaultPassword) {
          setIsDefaultPassword(true);
          setShowChangePassword(true);
        }
      } else {
        setLoginError('Incorrect password');
      }
    } catch (err) {
      setLoginError('Connection error. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Reset password with security question
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetError('');
    setResetSuccess('');

    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match');
      return;
    }

    if (newPassword.length < 4) {
      setResetError('Password must be at least 4 characters');
      return;
    }

    setIsResetting(true);

    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ securityAnswer, newPassword })
      });

      if (response.ok) {
        setResetSuccess('Password reset successfully! You can now sign in.');
        setSecurityAnswer('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setShowForgotPassword(false);
          setShowChangePassword(false);
          setResetSuccess('');
        }, 2000);
      } else {
        const data = await response.json();
        setResetError(data.error || 'Failed to reset password');
      }
    } catch (err) {
      setResetError('Connection error. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  // Create standby activation URL
  const createStandbyUrl = async () => {
    setIsCreatingStandby(true);
    setStandbyError('');
    setStandbyLink('');

    try {
      const response = await fetch(`${API_BASE}/admin/activations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber: standbyPhone,
          notes: 'Created from webapp'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create standby URL');
      }

      const data = await response.json();
      const baseUrl = 'https://ezrefillny.net';
      const longUrl = `${baseUrl}/activate?id=${data.id}`;
      setStandbyLink(longUrl);
    } catch (err) {
      setStandbyError('Failed to create standby URL. Make sure the server is running.');
    } finally {
      setIsCreatingStandby(false);
    }
  };

  const copyStandbyLink = () => {
    navigator.clipboard.writeText(standbyLink);
  };

  // Parse LPA code and generate activation link
  const parseLpaCode = (code) => {
    // LPA format: LPA:1$<SM-DP+ Address>$<Activation Code>$<Confirmation Code (optional)>
    const lpaRegex = /^LPA:1\$([^$]+)\$([^$]+)(?:\$([^$]*))?$/i;
    const match = code.trim().match(lpaRegex);

    if (!match) {
      return null;
    }

    return {
      smdpAddress: match[1],
      activationCode: match[2],
      confirmationCode: match[3] || ''
    };
  };

  const generateLink = (lpaData) => {
    // Apple Universal Link for eSIM installation (iOS 17.4+)
    const lpaString = `LPA:1$${lpaData.smdpAddress}$${lpaData.activationCode}${lpaData.confirmationCode ? '$' + lpaData.confirmationCode : ''}`;

    // Direct Apple eSIM setup URL
    const appleLink = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaString)}`;

    // Create a redirect URL that forces Safari to open (bypasses WeChat browser)
    // Uses the deployed redirect page
    const baseUrl = 'https://ezrefillny.net';
    const safariRedirectLink = `${baseUrl}/redirect?url=${encodeURIComponent(appleLink)}`;

    return safariRedirectLink;
  };

  // eslint-disable-next-line no-unused-vars
  const getDirectAppleLink = (lpaData) => {
    const lpaString = `LPA:1$${lpaData.smdpAddress}$${lpaData.activationCode}${lpaData.confirmationCode ? '$' + lpaData.confirmationCode : ''}`;
    return `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaString)}`;
  };


  const handleConvert = async () => {
    setError('');
    setGeneratedLink('');
    setQrCodeDataUrl('');

    if (!lpaCode.trim()) {
      setError('Please enter or scan an LPA QR code');
      return;
    }

    const parsed = parseLpaCode(lpaCode);

    if (!parsed) {
      setError('Invalid LPA format. Expected: LPA:1$<SM-DP+ Address>$<Activation Code>');
      return;
    }

    const link = generateLink(parsed);
    setGeneratedLink(link);

    // Generate QR code for the link
    try {
      const qrDataUrl = await QRCode.toDataURL(link, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1e293b',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(qrDataUrl);
    } catch (err) {
      console.error('QR generation error:', err);
    }
  };

  const initScanner = async () => {
    if (scannerInitialized.current) return;

    setScannerError('');

    try {
      html5QrCodeRef.current = new Html5Qrcode("qr-reader", {
        // Optimize for speed
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true // Use native BarcodeDetector API if available
        }
      });

      await html5QrCodeRef.current.start(
        { facingMode: "environment" },
        {
          fps: 30, // Increased FPS for faster scanning
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
          disableFlip: false,
          // Optimized scanning settings
          formatsToSupport: [0] // QR_CODE only = faster
        },
        async (decodedText) => {
          // Pause scanner after successful scan
          if (html5QrCodeRef.current) {
            html5QrCodeRef.current.pause(true);
            setScannerPaused(true);
          }
          setLpaCode(decodedText);
          // Auto-convert when QR is scanned
          const parsed = parseLpaCode(decodedText);
          if (parsed) {
            setParsedLpaData(parsed); // Store for confirmation display
            const link = generateLink(parsed);
            setGeneratedLink(link);
            // Generate QR code for the redirect link
            QRCode.toDataURL(link, {
              width: 256,
              margin: 2,
              color: { dark: '#1e293b', light: '#ffffff' }
            }).then(setQrCodeDataUrl).catch(console.error);
            // Auto-create short link
            createShortLink(decodedText);
          }
        },
        () => { }
      );
      setScannerReady(true);
      scannerInitialized.current = true;
    } catch (err) {
      setScannerError('Camera access denied or not available');
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setError('');

    try {
      const html5QrCode = new Html5Qrcode("file-reader");
      const result = await html5QrCode.scanFile(file, true);
      setLpaCode(result);
      html5QrCode.clear();
    } catch (err) {
      setError('Could not read QR code from image');
    }
  };

  // Screen Cutout Functions - made instant (directly captures without extra click)
  const startScreenCutout = async () => {
    if (cutoutActive) {
      cancelCutout();
      return;
    }
    setCutoutActive(true);
    setCutoutStatus('Select the screen/window to capture...');
    setCutoutPreview('');
    // Immediately trigger capture instead of waiting for button click
    await captureScreen();
  };

  const cancelCutout = () => {
    setCutoutActive(false);
    setCutoutStatus('');
    setCutoutPreview('');
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const captureScreen = async () => {
    setCutoutStatus('Select the screen/window to capture...');

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          cursor: 'never'
        },
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        systemAudio: 'exclude'
      });

      // Create video element to capture frame
      const video = document.createElement('video');
      video.srcObject = mediaStreamRef.current;
      video.autoplay = true;

      // Wait for video to be ready
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      // Small delay to ensure frame is rendered
      await new Promise(resolve => setTimeout(resolve, 100));

      setCutoutStatus('Capturing screenshot...');

      // Capture the frame to canvas
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);

      // Stop the stream immediately after capture
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;

      // Convert to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

      // Show preview
      const imageUrl = URL.createObjectURL(blob);
      setCutoutPreview(imageUrl);

      setCutoutStatus('Processing QR code...');

      // Process the image for QR code
      await processScreenshotForQR(blob);

    } catch (err) {
      console.error('Screen capture error:', err);
      if (err.name === 'NotAllowedError') {
        setCutoutStatus('Screen capture was cancelled');
      } else {
        setCutoutStatus('Error: ' + (err.message || 'Could not capture screen'));
      }
      setTimeout(() => {
        setCutoutStatus('Click "Start Capture" to try again');
      }, 3000);
    }
  };

  const processScreenshotForQR = async (blob) => {
    try {
      // Create a File object from the blob
      const file = new File([blob], 'screenshot.png', { type: 'image/png' });

      // Use Html5Qrcode to scan the file
      const tempScanner = new Html5Qrcode("file-reader");
      const result = await tempScanner.scanFile(file, true);

      if (result.startsWith('LPA:')) {
        setLpaCode(result);
        setCutoutStatus('✓ LPA Code extracted from screenshot!');

        // Auto-convert
        const parsed = parseLpaCode(result);
        if (parsed) {
          setParsedLpaData(parsed); // Store for confirmation display
          const link = generateLink(parsed);
          setGeneratedLink(link);
          QRCode.toDataURL(link, {
            width: 256,
            margin: 2,
            color: { dark: '#1e293b', light: '#ffffff' }
          }).then(setQrCodeDataUrl).catch(console.error);
          // Auto-create short link
          createShortLink(result);
        }

        // Auto-close after success
        setTimeout(() => {
          cancelCutout();
        }, 2000);
      } else {
        setCutoutStatus('QR code found but not an LPA code: ' + result.substring(0, 50));
        setTimeout(() => {
          setCutoutStatus('Click "Start Capture" to try again');
        }, 3000);
      }

      await tempScanner.clear();
    } catch (err) {
      console.error('QR scan error:', err);
      setCutoutStatus('No QR code found in screenshot. Try capturing a clearer image.');
      setTimeout(() => {
        setCutoutStatus('Click "Start Capture" to try again');
      }, 3000);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'eSIM Activation Link',
          text: 'Click to install your eSIM (iOS 17.4+)',
          url: generatedLink
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyToClipboard();
        }
      }
    } else {
      copyToClipboard();
    }
  };

  const reset = () => {
    setLpaCode('');
    setSmdpAddress('');
    setActivationCode('');
    setGeneratedLink('');
    setQrCodeDataUrl('');
    setError('');
    setCopied(false);
    setParsedLpaData(null); // Clear confirmation data
    setShortLink(''); // Clear short link
    // Resume scanner
    if (html5QrCodeRef.current && scannerPaused) {
      html5QrCodeRef.current.resume();
      setScannerPaused(false);
    }
  };

  // Generate link from manual SM-DP+ and Activation Code input
  const handleManualGenerate = async () => {
    setError('');
    setGeneratedLink('');
    setQrCodeDataUrl('');

    if (!smdpAddress.trim() || !activationCode.trim()) {
      setError('Please enter both SM-DP+ Address and Activation Code');
      return;
    }

    const lpaData = {
      smdpAddress: smdpAddress.trim(),
      activationCode: activationCode.trim(),
      confirmationCode: ''
    };

    const link = generateLink(lpaData);
    setGeneratedLink(link);
    setParsedLpaData(lpaData);
    setLpaCode(`LPA:1$${lpaData.smdpAddress}$${lpaData.activationCode}`);

    // Pause scanner if running
    if (html5QrCodeRef.current && scannerReady && !scannerPaused) {
      html5QrCodeRef.current.pause(true);
      setScannerPaused(true);
    }

    // Generate QR code
    try {
      const qrDataUrl = await QRCode.toDataURL(link, {
        width: 256,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' }
      });
      setQrCodeDataUrl(qrDataUrl);
      // Create short link
      const lpaCodeStr = `LPA:1$${lpaData.smdpAddress}$${lpaData.activationCode}`;
      createShortLink(lpaCodeStr);
    } catch (err) {
      console.error('QR generation error:', err);
    }
  };

  useEffect(() => {
    // Auto-start scanner on mount
    const timer = setTimeout(() => {
      initScanner();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (html5QrCodeRef.current && scannerInitialized.current) {
        html5QrCodeRef.current.stop().catch(() => { });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Login screen
  if (!isAuthenticated) {
    // Forgot password form
    if (showForgotPassword) {
      return (
        <div className="app">
          <div className="container">
            <div className="login-screen">
              <div className="login-card">
                <div className="login-logo">
                  <Smartphone className="logo-icon" />
                  <h1>EZRefill</h1>
                </div>
                <p className="login-subtitle">Reset Password</p>
                <form onSubmit={handleResetPassword} className="login-form">
                  <div className="input-group">
                    <label htmlFor="security-answer">What is our UltraMobile dealer code?</label>
                    <input
                      type="text"
                      id="security-answer"
                      value={securityAnswer}
                      onChange={(e) => setSecurityAnswer(e.target.value)}
                      placeholder="Enter answer (all lowercase)"
                      autoFocus
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="new-password">New Password</label>
                    <input
                      type="password"
                      id="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="confirm-password">Confirm Password</label>
                    <input
                      type="password"
                      id="confirm-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                    />
                  </div>
                  {resetError && <div className="error-message">{resetError}</div>}
                  {resetSuccess && <div className="success-message">{resetSuccess}</div>}
                  <button type="submit" className="primary-btn login-btn" disabled={isResetting}>
                    {isResetting ? 'Resetting...' : 'Reset Password'}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setResetError('');
                      setResetSuccess('');
                    }}
                  >
                    Back to Sign In
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="app">
        <div className="container">
          <div className="login-screen">
            <div className="login-card">
              <div className="login-logo">
                <Smartphone className="logo-icon" />
                <h1>EZRefill</h1>
              </div>
              <p className="login-subtitle">eSIM Quick Access Tool</p>
              <form onSubmit={handleLogin} className="login-form">
                <div className="input-group">
                  <label htmlFor="login-password">Password</label>
                  <input
                    type="password"
                    id="login-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password"
                    autoFocus
                  />
                </div>
                {loginError && <div className="error-message">{loginError}</div>}
                <button type="submit" className="primary-btn login-btn" disabled={isLoggingIn}>
                  {isLoggingIn ? 'Signing in...' : 'Sign In'}
                </button>
                <button
                  type="button"
                  className="forgot-password-btn"
                  onClick={() => setShowForgotPassword(true)}
                >
                  Forgot Password?
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Change password modal (shown after login with default password)
  if (showChangePassword) {
    return (
      <div className="app">
        <div className="container">
          <div className="login-screen">
            <div className="login-card">
              <div className="login-logo">
                <Smartphone className="logo-icon" />
                <h1>EZRefill</h1>
              </div>
              <p className="login-subtitle">
                {isDefaultPassword ? 'Please set a new password' : 'Change Password'}
              </p>
              <form onSubmit={handleResetPassword} className="login-form">
                <div className="input-group">
                  <label htmlFor="security-answer">What is our UltraMobile dealer code?</label>
                  <input
                    type="text"
                    id="security-answer"
                    value={securityAnswer}
                    onChange={(e) => setSecurityAnswer(e.target.value)}
                    placeholder="Enter answer (all lowercase)"
                    autoFocus
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="new-password">New Password</label>
                  <input
                    type="password"
                    id="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="confirm-password">Confirm Password</label>
                  <input
                    type="password"
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </div>
                {resetError && <div className="error-message">{resetError}</div>}
                {resetSuccess && <div className="success-message">{resetSuccess}</div>}
                <button type="submit" className="primary-btn login-btn" disabled={isResetting}>
                  {isResetting ? 'Saving...' : 'Set New Password'}
                </button>
                {!isDefaultPassword && (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setShowChangePassword(false)}
                  >
                    Cancel
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <div className="header-top">
            <div className="logo">
              <Smartphone className="logo-icon" />
              <h1>EZRefill</h1>
            </div>
            <a href="/admin" className="admin-btn" title="Admin Panel">
              <Settings size={18} />
            </a>
          </div>
          <p className="subtitle">eSIM 快速激活链接生成器</p>
        </header>

        <main className="main">
          {/* Input Section */}
          <section className="card input-section">
            <h2>
              <QrCode size={20} />
              Scan or Enter LPA Code
            </h2>

            <div className="scanner-container">
              <div id="qr-reader"></div>
              {!scannerReady && !scannerError && (
                <div className="scanner-loading">
                  <Camera size={24} />
                  <span>Starting camera...</span>
                </div>
              )}
              {scannerError && (
                <div className="scanner-error">
                  <X size={24} />
                  <span>{scannerError}</span>
                  <button onClick={initScanner} className="retry-btn">Retry</button>
                </div>
              )}
              {scannerReady && !scannerPaused && (
                <div className="scanner-hint">Point camera at LPA QR code</div>
              )}
              {scannerPaused && (
                <div className="scanner-paused">
                  <Check size={32} />
                  <span>QR Code Scanned!</span>
                </div>
              )}
            </div>

            <div className="input-methods">
              <label className="method-btn">
                <Upload size={18} />
                Upload QR Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  hidden
                />
              </label>
              <button
                className={`method-btn cutout-btn ${cutoutActive ? 'active' : ''}`}
                onClick={startScreenCutout}
              >
                <ScreenShare size={18} />
                {cutoutActive ? 'Cancel Cutout' : 'Screen Cutout'}
              </button>
            </div>

            {/* Screen Cutout Panel */}
            {cutoutActive && (
              <div className="cutout-panel">
                <div className="cutout-status">
                  <Crosshair size={20} className="cutout-icon" />
                  <span>{cutoutStatus}</span>
                </div>
                <div className="cutout-actions">
                  <button className="capture-btn" onClick={captureScreen}>
                    <Crosshair size={18} />
                    Start Capture
                  </button>
                  <button className="cancel-btn" onClick={cancelCutout}>
                    <X size={18} />
                    Cancel
                  </button>
                </div>
                {cutoutPreview && (
                  <div className="cutout-preview">
                    <img src={cutoutPreview} alt="Captured screenshot" />
                  </div>
                )}
              </div>
            )}

            <div id="file-reader" style={{ display: 'none' }}></div>

            {/* Manual Input Section */}
            <div className="manual-input-section">
              <h3>Manual Entry</h3>
              <div className="input-group">
                <label htmlFor="smdp-input">SM-DP+ Address</label>
                <input
                  type="text"
                  id="smdp-input"
                  value={smdpAddress}
                  onChange={(e) => setSmdpAddress(e.target.value)}
                  placeholder="e.g. t-mobile.idemia.io"
                />
              </div>
              <div className="input-group">
                <label htmlFor="activation-input">Activation Code</label>
                <input
                  type="text"
                  id="activation-input"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value)}
                  placeholder="e.g. G0LFC-8Z7IK-HYBGV-6CLG1"
                />
              </div>
              <button className="primary-btn" onClick={handleManualGenerate}>
                <Link2 size={18} />
                Generate Link
              </button>
            </div>

            <div className="divider"><span>or scan QR code</span></div>

            <div className="input-group">
              <label htmlFor="lpa-input">LPA Code (from QR)</label>
              <textarea
                id="lpa-input"
                value={lpaCode}
                onChange={(e) => setLpaCode(e.target.value)}
                placeholder="LPA:1$smdp.example.com$ACTIVATION-CODE-HERE"
                rows={2}
                readOnly
              />
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="button-group">
              <button className="primary-btn" onClick={handleConvert}>
                <Link2 size={18} />
                Generate Link
              </button>
              {(lpaCode || generatedLink) && (
                <button className="secondary-btn" onClick={reset}>
                  <RefreshCw size={18} />
                  Reset
                </button>
              )}
            </div>
          </section>

          {/* Output Section */}
          {generatedLink && (
            <section className="card output-section">
              <h2>
                <ExternalLink size={20} />
                Generated Activation Link
              </h2>

              {/* SMDP Confirmation Display */}
              {parsedLpaData && (
                <div className="smdp-confirmation" style={{
                  background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                  border: '1px solid #7dd3fc',
                  borderRadius: '12px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <Check size={20} style={{ color: '#0ea5e9' }} />
                    <span style={{ fontWeight: '600', color: '#0369a1' }}>QR Code Verified</span>
                  </div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SM-DP+ Server</span>
                      <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1e293b', wordBreak: 'break-all', background: 'white', padding: '8px 10px', borderRadius: '6px', marginTop: '4px' }}>
                        {parsedLpaData.smdpAddress}
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Activation Code</span>
                      <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1e293b', wordBreak: 'break-all', background: 'white', padding: '8px 10px', borderRadius: '6px', marginTop: '4px' }}>
                        {parsedLpaData.activationCode}
                      </div>
                    </div>
                    {parsedLpaData.confirmationCode && (
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Confirmation Code</span>
                        <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1e293b', background: 'white', padding: '8px 10px', borderRadius: '6px', marginTop: '4px' }}>
                          {parsedLpaData.confirmationCode}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Short Link Display */}
              <div className="quick-copy" style={{ marginBottom: '16px' }}>
                {isCreatingShortLink ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                    <RefreshCw size={18} className="spinning" />
                    <span>Creating short link...</span>
                  </div>
                ) : shortLink ? (
                  <div style={{
                    background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                    border: '1px solid #86efac',
                    borderRadius: '10px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '11px', fontWeight: '600', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Share Link</span>
                      <code style={{ display: 'block', fontSize: '14px', color: '#15803d', fontWeight: '600', marginTop: '4px', wordBreak: 'break-all' }}>{shortLink}</code>
                    </div>
                    <button
                      className={`copy-link-btn ${copied ? 'copied' : ''}`}
                      onClick={() => {
                        navigator.clipboard.writeText(shortLink);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      style={{ flexShrink: 0 }}
                    >
                      {copied ? <Check size={18} /> : <Copy size={18} />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <button
                    className={`copy-link-btn ${copied ? 'copied' : ''}`}
                    onClick={() => {
                      navigator.clipboard.writeText(generatedLink);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                    {copied ? 'Copied!' : 'Copy Full Link'}
                  </button>
                )}
              </div>

              <div className="link-actions">
                <a
                  href={`weixin://`}
                  className="wechat-btn full-width"
                  onClick={(e) => {
                    navigator.clipboard.writeText(generatedLink).catch(() => { });
                  }}
                >
                  <MessageCircle size={20} />
                  Share to WeChat
                </a>
              </div>

              <div className="link-display">
                <code>{generatedLink}</code>
                <button
                  className="icon-btn"
                  onClick={shareLink}
                  title="Share link"
                >
                  <Share2 size={18} />
                </button>
              </div>

              <div className="info-box">
                <h3>How to use:</h3>
                <ul>
                  <li><strong>iOS 17.4+:</strong> Tap "Share to WeChat" and send the link to yourself or others</li>
                  <li><strong>WeChat:</strong> Open the link in WeChat to activate eSIM directly</li>
                </ul>
              </div>
            </section>
          )}

          {/* Standby URL Section */}
          <section className="card standby-section">
            <h2>
              <Clock size={20} />
              Create Standby URL
            </h2>
            <p className="section-desc">Generate a pre-activation link for customers. Add LPA code later via Admin Panel.</p>

            <div className="input-group">
              <label htmlFor="standby-phone">
                <Phone size={14} style={{ display: 'inline', marginRight: '6px' }} />
                Customer Phone (Optional)
              </label>
              <input
                type="text"
                id="standby-phone"
                value={standbyPhone}
                onChange={(e) => setStandbyPhone(e.target.value)}
                placeholder="e.g. 718-555-1234"
              />
            </div>

            <button
              className="primary-btn standby-btn"
              onClick={createStandbyUrl}
              disabled={isCreatingStandby}
            >
              {isCreatingStandby ? (
                <><RefreshCw size={18} className="spinning" /> Creating...</>
              ) : (
                <><Clock size={18} /> Generate Standby URL</>
              )}
            </button>

            {standbyError && (
              <div className="error-message">{standbyError}</div>
            )}

            {standbyLink && (
              <div className="standby-result">
                <div className="standby-link-display">
                  <span className="standby-label">Full Link:</span>
                  <code className="standby-url">{standbyLink}</code>
                  <button className="copy-standby-btn" onClick={copyStandbyLink}>
                    <Copy size={16} />
                  </button>
                </div>
                <p className="standby-hint">Send this link to customer. Activate it later in the Admin Panel.</p>
              </div>
            )}
          </section>
        </main>

        <footer className="footer">
          <p>Powered by EZRefill eSIM</p>
          <a href="/admin" className="footer-admin-link">
            <Settings size={14} /> Admin Panel
          </a>
        </footer>
      </div>
    </div>
  );
}

export default App;
