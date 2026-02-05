# EzRefill eSIM Activation Management System

## Overview

This system allows you to create pre-generated activation URLs for customers that can be in "standby" mode until you add the LPA code to activate them.

## Features

- **Standby URLs**: Generate URLs for customers before their eSIM is ready
- **Status Tracking**: Track activations as Standby → Processing → Active
- **Phone Number Tracking**: Associate customer phone numbers with activations
- **Constant URLs**: The customer URL never changes, even when status updates
- **Auto Language Detection**: Redirect page auto-detects Chinese/English
- **Secure Admin Panel**: Password-protected management interface

## Setup

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Start the Server

```bash
npm start
```

The server runs on port 3001 by default.

### 3. Default Login

- **Username**: `admin`
- **Password**: `Aa13678!`

⚠️ **Change the password after first login!**

## Usage

### Creating a Standby Activation

1. Go to `/admin.html`
2. Login with your credentials
3. Click "New Activation"
4. Enter customer's phone number (optional but recommended)
5. Leave LPA Code empty for standby mode
6. Click "Create"
7. Copy the generated link and send to customer

### Activating an eSIM

1. Go to `/admin.html`
2. Find the activation in the list
3. Click the edit (pencil) icon
4. Paste the LPA code (format: `LPA:1$smdp.example.com$ACTIVATION-CODE`)
5. Click "Save"
6. The customer's page will automatically update to show "Ready" status

### Customer Experience

- **Standby**: Customer sees "Awaiting Activation" with a disabled button
- **Processing**: Customer sees "Processing..." with a loading indicator
- **Active**: Customer sees "Activate Now" button that works

The page auto-refreshes every 10 seconds when in standby/processing mode.

## API Endpoints

### Public

- `GET /api/activation/:id` - Get activation status (for redirect page)

### Protected (requires Bearer token)

- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verify token
- `GET /api/admin/activations` - List all activations
- `POST /api/admin/activations` - Create new activation
- `PUT /api/admin/activations/:id` - Update activation
- `DELETE /api/admin/activations/:id` - Delete activation

## File Structure

```
server/
├── index.js          # Main API server
├── package.json      # Dependencies
├── data/
│   ├── activations.json  # Activation records
│   └── users.json        # Admin users
└── README.md

public/
├── activate.html     # Dynamic customer activation page
├── admin.html        # Admin management panel
└── redirect.html     # Original static redirect page
```

## Production Deployment

For production, you should:

1. Set `JWT_SECRET` environment variable to a secure random string
2. Use a proper database (MongoDB, PostgreSQL) instead of JSON files
3. Set up HTTPS
4. Configure CORS properly
5. Use a process manager like PM2

```bash
JWT_SECRET=your-secure-secret-key PORT=3001 npm start
```

## Customer URL Format

```
https://yourdomain.com/activate.html?id=abc12345
```

The `id` is a short unique identifier generated for each activation.
