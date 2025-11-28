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
  Download,
  MessageCircle
} from 'lucide-react';
import './App.css';

function App() {
  const [lpaCode, setLpaCode] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [scannerReady, setScannerReady] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const html5QrCodeRef = useRef(null);
  const scannerInitialized = useRef(false);
  const fileInputRef = useRef(null);

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
    // Format: https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$GSMA_SMDP_Address$activation_code
    // Note: Universal Links should be all lower case per Apple docs, but carddata value is case-sensitive
    const lpaString = `LPA:1$${lpaData.smdpAddress}$${lpaData.activationCode}${lpaData.confirmationCode ? '$' + lpaData.confirmationCode : ''}`;
    
    // Apple's eSIM setup Universal Link (works on iOS 17.4+)
    const appleLink = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaString)}`;
    
    return appleLink;
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
      html5QrCodeRef.current = new Html5Qrcode("qr-reader");
      
      await html5QrCodeRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          setLpaCode(decodedText);
          // Auto-convert when QR is scanned
          const parsed = parseLpaCode(decodedText);
          if (parsed) {
            const link = generateLink(parsed);
            setGeneratedLink(link);
            // Generate QR code
            QRCode.toDataURL(link, {
              width: 256,
              margin: 2,
              color: { dark: '#1e293b', light: '#ffffff' }
            }).then(setQrCodeDataUrl).catch(console.error);
          }
        },
        () => {}
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
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
    setGeneratedLink('');
    setQrCodeDataUrl('');
    setError('');
    setCopied(false);
  };

  useEffect(() => {
    // Auto-start scanner on mount
    const timer = setTimeout(() => {
      initScanner();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (html5QrCodeRef.current && scannerInitialized.current) {
        html5QrCodeRef.current.stop().catch(() => {});
      }
    };
  }, []);

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <div className="logo">
            <Smartphone className="logo-icon" />
            <h1>LPA QR to Link</h1>
          </div>
          <p className="subtitle">Convert eSIM QR codes to shareable activation links</p>
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
              {scannerReady && (
                <div className="scanner-hint">Point camera at LPA QR code</div>
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
                  ref={fileInputRef}
                  hidden 
                />
              </label>
            </div>

            <div id="file-reader" style={{ display: 'none' }}></div>

            <div className="input-group">
              <label htmlFor="lpa-input">LPA Code</label>
              <textarea
                id="lpa-input"
                value={lpaCode}
                onChange={(e) => setLpaCode(e.target.value)}
                placeholder="LPA:1$smdp.example.com$ACTIVATION-CODE-HERE"
                rows={3}
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

              <div className="quick-copy">
                <button 
                  className={`copy-link-btn ${copied ? 'copied' : ''}`}
                  onClick={copyToClipboard}
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>

              <div className="link-actions">
                <a 
                  href={generatedLink} 
                  className="install-btn"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Smartphone size={20} />
                  Install eSIM Now
                </a>
                <a 
                  href={`weixin://`}
                  className="wechat-btn"
                  onClick={(e) => {
                    // Copy link first, then open WeChat
                    navigator.clipboard.writeText(generatedLink).catch(() => {});
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

              {qrCodeDataUrl && (
                <div className="qr-output">
                  <p>QR code for Android & older iOS:</p>
                  <img src={qrCodeDataUrl} alt="eSIM Activation QR Code" />
                  <a 
                    href={qrCodeDataUrl} 
                    download="esim-activation-qr.png"
                    className="download-btn"
                  >
                    <Download size={16} />
                    Save QR Code
                  </a>
                </div>
              )}

              <div className="info-box">
                <h3>How to use:</h3>
                <ul>
                  <li><strong>iOS 17.4+:</strong> Tap "Install eSIM Now" or share the link</li>
                  <li><strong>Android:</strong> Scan the QR code in Settings → Network → eSIM</li>
                  <li><strong>Older iOS:</strong> Scan the QR code with Camera app</li>
                </ul>
              </div>
            </section>
          )}
        </main>

        <footer className="footer">
          <p>This tool converts LPA QR codes to universal eSIM activation links</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
