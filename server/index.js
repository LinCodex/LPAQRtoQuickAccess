const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'ezrefill-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const ACTIVATIONS_FILE = path.join(DATA_DIR, 'activations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data files if they don't exist
if (!fs.existsSync(ACTIVATIONS_FILE)) {
  fs.writeFileSync(ACTIVATIONS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(USERS_FILE)) {
  // Create default admin user (password: Aa13678!)
  const defaultAdmin = {
    id: uuidv4(),
    username: 'admin',
    password: bcrypt.hashSync('Aa13678!', 10),
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(USERS_FILE, JSON.stringify([defaultAdmin], null, 2));
}

// Helper functions
const readActivations = () => {
  try {
    return JSON.parse(fs.readFileSync(ACTIVATIONS_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
};

const writeActivations = (data) => {
  fs.writeFileSync(ACTIVATIONS_FILE, JSON.stringify(data, null, 2));
};

const readUsers = () => {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (error) {
    return [];
  }
};

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ============ PUBLIC ROUTES ============

// Get activation status (public - for redirect page)
app.get('/api/activation/:id', (req, res) => {
  const { id } = req.params;
  const activations = readActivations();
  const activation = activations.find(a => a.id === id);

  if (!activation) {
    return res.status(404).json({ error: 'Activation not found' });
  }

  // Return only public info
  res.json({
    id: activation.id,
    status: activation.status, // 'standby', 'processing', 'active'
    phoneNumber: activation.phoneNumber ? maskPhoneNumber(activation.phoneNumber) : null,
    lpaCode: activation.status === 'active' ? activation.lpaCode : null,
    activationUrl: activation.status === 'active' ? generateActivationUrl(activation.lpaCode) : null,
    createdAt: activation.createdAt,
    updatedAt: activation.updatedAt
  });
});

// ============ AUTH ROUTES ============

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.username === username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username });
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, username: req.user.username });
});

// Change password
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const users = readUsers();
  const userIndex = users.findIndex(u => u.id === req.user.id);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!bcrypt.compareSync(currentPassword, users[userIndex].password)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  users[userIndex].password = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ message: 'Password changed successfully' });
});

// ============ PUBLIC STANDBY CREATION ============

// Create standby activation (public - for webapp)
app.post('/api/admin/activations', (req, res, next) => {
  // Check if this is an authenticated request
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    // If token provided, verify it and continue to authenticated handler
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
      next();
    });
  } else {
    // No token - allow public standby creation
    next();
  }
}, (req, res) => {
  const { phoneNumber, notes, lpaCode, status } = req.body;
  const activations = readActivations();

  // If LPA code is provided and no auth, reject
  if (lpaCode && !req.user) {
    return res.status(401).json({ error: 'Authentication required to set LPA code' });
  }

  const newActivation = {
    id: uuidv4().split('-')[0], // Short ID for easier sharing
    phoneNumber: phoneNumber || '',
    notes: notes || '',
    status: status || 'standby',
    lpaCode: lpaCode || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: req.user ? req.user.username : 'webapp'
  };

  activations.push(newActivation);
  writeActivations(activations);

  res.status(201).json(newActivation);
});

// ============ ADMIN ROUTES (Protected) ============

// Get all activations
app.get('/api/admin/activations', authenticateToken, (req, res) => {
  const activations = readActivations();
  // Sort by createdAt descending (newest first)
  activations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(activations);
});

// Update activation
app.put('/api/admin/activations/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { phoneNumber, notes, status, lpaCode } = req.body;
  const activations = readActivations();
  const index = activations.findIndex(a => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Activation not found' });
  }

  // Update fields
  if (phoneNumber !== undefined) activations[index].phoneNumber = phoneNumber;
  if (notes !== undefined) activations[index].notes = notes;
  if (lpaCode !== undefined) activations[index].lpaCode = lpaCode;

  if (status !== undefined) activations[index].status = status;

  activations[index].updatedAt = new Date().toISOString();
  activations[index].updatedBy = req.user.username;

  writeActivations(activations);
  res.json(activations[index]);
});

// Delete activation
app.delete('/api/admin/activations/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const activations = readActivations();
  const index = activations.findIndex(a => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Activation not found' });
  }

  activations.splice(index, 1);
  writeActivations(activations);
  res.json({ message: 'Activation deleted' });
});

// ============ HELPER FUNCTIONS ============

function maskPhoneNumber(phone) {
  if (!phone || phone.length < 4) return phone;
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
}

function generateActivationUrl(lpaCode) {
  if (!lpaCode) return null;

  // Parse LPA code
  const lpaRegex = /^LPA:1\$([^$]+)\$([^$]+)(?:\$([^$]*))?$/i;
  const match = lpaCode.trim().match(lpaRegex);

  if (!match) return null;

  const lpaString = lpaCode.trim();
  return `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaString)}`;
}

const SHORTLINKS_FILE = path.join(DATA_DIR, 'shortlinks.json');

// Initialize shortlinks file if it doesn't exist
if (!fs.existsSync(SHORTLINKS_FILE)) {
  fs.writeFileSync(SHORTLINKS_FILE, JSON.stringify({}, null, 2));
}

const readShortLinks = () => {
  try {
    return JSON.parse(fs.readFileSync(SHORTLINKS_FILE, 'utf8'));
  } catch (error) {
    return {};
  }
};

const writeShortLinks = (data) => {
  fs.writeFileSync(SHORTLINKS_FILE, JSON.stringify(data, null, 2));
};

// Generate short 6-character ID (base62)
function generateShortId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ... existing endpoints ...

// ============ SHORT LINK ROUTES ============

// Create short link
app.post('/api/shortlink', (req, res) => {
  const { lpaCode } = req.body;

  if (!lpaCode || !lpaCode.startsWith('LPA:')) {
    return res.status(400).json({ error: 'Invalid LPA code' });
  }

  try {
    const shortLinks = readShortLinks();

    // Generate unique short ID
    let shortId = generateShortId();
    let attempts = 0;

    // Ensure uniqueness
    while (shortLinks[shortId] && attempts < 10) {
      shortId = generateShortId();
      attempts++;
    }

    // Store short link
    // Note: Local storage doesn't implement expiry for simplicity, but Vercel/Redis does (30 days)
    shortLinks[shortId] = {
      lpaCode,
      createdAt: new Date().toISOString()
    };

    writeShortLinks(shortLinks);

    const domain = req.protocol + '://' + req.get('host');

    return res.status(201).json({
      shortId,
      shortUrl: `${domain}/s/${shortId}`,
      lpaCode
    });
  } catch (error) {
    console.error('Error creating short link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get short link
app.get('/api/shortlink/:id', (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Missing short link ID' });
  }

  try {
    const shortLinks = readShortLinks();
    const linkData = shortLinks[id];

    if (!linkData) {
      return res.status(404).json({ error: 'Short link not found' });
    }

    // Generate activation URL
    const activationUrl = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(linkData.lpaCode)}`;

    return res.json({
      lpaCode: linkData.lpaCode,
      activationUrl
    });
  } catch (error) {
    console.error('Error fetching short link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`EZRefill API Server running on port ${PORT}`);
  console.log(`Default admin credentials: admin / Aa13678!`);
  console.log(`Please change the password after first login!`);
});

