# LPA QR to Link

A simple web app that converts eSIM LPA QR codes into shareable activation links.

## Features

- **QR Code Scanner**: Use your device camera to scan LPA QR codes
- **Image Upload**: Upload QR code images for conversion
- **Manual Input**: Paste LPA codes directly
- **Link Generation**: Creates Apple eSIM setup URLs that work on iOS devices
- **QR Code Output**: Generates a new QR code for the activation link
- **Copy & Share**: Easy copy-to-clipboard functionality

## LPA Code Format

LPA (Local Profile Assistant) codes follow this format:
```
LPA:1$<SM-DP+ Address>$<Activation Code>$<Confirmation Code (optional)>
```

Example:
```
LPA:1$smdp.example.com$K2-ABC123-DEF456
```

## How It Works

1. Scan or enter an LPA QR code
2. The app parses the LPA data
3. Generates an Apple eSIM setup URL
4. Creates a shareable QR code

## Usage

### For iOS Users
- Click the generated link to automatically open eSIM setup
- Or scan the generated QR code

### For Android Users
- Go to Settings → Network → eSIM
- Scan the generated QR code

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build
```

## Tech Stack

- React 18
- html5-qrcode (QR scanning)
- qrcode (QR generation)
- Lucide React (icons)
