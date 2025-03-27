require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const app = express();
const appointmentRoutes = require('./routes/appointmentRoutes');
const messageRoutes = require('./routes/messageRoutes');
const leadRoutes = require('./routes/leadRoutes');

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('ERROR: MongoDB URI is not defined! Check your environment variables.');
    // Fail gracefully instead of crashing
    // You can choose to either exit the process or continue with limited functionality
    console.log('Application will continue but database functionality will be limited.');
} else {
    mongoose.connect(MONGO_URI, { 
        useNewUrlParser: true, 
        useUnifiedTopology: true,
        bufferCommands: false, // Disable buffering to prevent timeout errors
        serverSelectionTimeoutMS: 5000, // Decrease the timeout for server selection
        socketTimeoutMS: 45000 // How long sockets stay open for
    })
        .then(() => console.log('Connected to MongoDB'))
        .catch((err) => console.error('MongoDB connection error:', err));
}

// Session Configuration
const sessionConfig = {
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Set to true in production with HTTPS
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
};

// Add MongoDB as the session store if MongoDB is connected
if (MONGO_URI) {
    sessionConfig.store = MongoStore.create({
        mongoUrl: MONGO_URI,
        touchAfter: 24 * 3600, // Only update the session once per day unless data changes
        crypto: {
            secret: 'squirrel' // Encrypt session data
        }
    });
    console.log('Using MongoDB for session storage');
} else {
    console.warn('Warning: Using MemoryStore for sessions (not recommended for production)');
}

app.use(session(sessionConfig));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.json());

// Define Schema and Model
const dataSchema = new mongoose.Schema({
    name: String,
    email: String,
    drName: String,
    department: String,
    appointmentDate: Date,
    appointmentTime: String
});

const Data = mongoose.model('hello', dataSchema);

// Feedback Schema
const feedbackSchema = new mongoose.Schema({
    name: String,
    email: String,
    rating: Number,
    message: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Feedback = mongoose.model('feedback', feedbackSchema);

// Login Credentials
const validCredentials = {
    username: 'vinay',
    password: 'vinaypassword'
};

// Middleware to check authentication
const requireLogin = (req, res, next) => {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Middleware to handle database operations safely
const handleDbOperation = async (operation, fallback, res) => {
    try {
        // Check if MongoDB connection is ready (0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting)
        if (mongoose.connection.readyState !== 1) {
            console.log('Database not connected, using fallback value');
            if (res && !res.headersSent) {
                res.locals.dbDisconnected = true;
            }
            return fallback;
        }
        
        // Execute the operation with a timeout protection
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database operation timed out')), 5000);
        });
        
        return await Promise.race([operation(), timeoutPromise]);
    } catch (error) {
        console.error('Database operation error:', error.message);
        if (res && !res.headersSent) {
            return res.status(500).render('error', { 
                message: 'Database error. Please try again later.' 
            });
        }
        return fallback;
    }
};

// Routes
app.get('/', (req, res) => {
    res.render('home');
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    const health = {
        uptime: process.uptime(),
        status: 'ok',
        timestamp: Date.now(),
        dbConnected: mongoose.connection.readyState === 1
    };
    res.status(200).json(health);
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === validCredentials.username && password === validCredentials.password) {
        req.session.loggedIn = true;
        res.redirect('/dashboard');
    } else {
        res.render('login', { error: 'Invalid credentials' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Protected Routes
app.get('/dashboard', requireLogin, async (req, res) => {
    const data = await handleDbOperation(
        async () => await Data.find(),
        [],
        res
    );
    if (!res.headersSent) {
        res.render('index', { data });
    }
});

app.get('/leads', requireLogin, async (req, res) => {
    res.render('leads');
});

app.get('/create', requireLogin, (req, res) => {
    res.render('create');
});

app.post('/create', requireLogin, async (req, res) => {
    await handleDbOperation(
        async () => {
            const newData = new Data({
                name: req.body.name,
                email: req.body.email,
                drName: req.body.drName,
                department: req.body.department,
                appointmentDate: req.body.appointmentDate,
                appointmentTime: req.body.appointmentTime
            });
            await newData.save();
            return true;
        },
        false,
        res
    );
    if (!res.headersSent) {
        res.redirect('/dashboard');
    }
});

app.get('/edit/:id', requireLogin, async (req, res) => {
    const data = await handleDbOperation(
        async () => await Data.findById(req.params.id),
        null,
        res
    );
    if (!res.headersSent) {
        res.render('edit', { data });
    }
});

app.post('/edit/:id', requireLogin, async (req, res) => {
    await handleDbOperation(
        async () => await Data.findByIdAndUpdate(req.params.id, {
            name: req.body.name,
            email: req.body.email,
            drName: req.body.drName,
            department: req.body.department,
            appointmentDate: req.body.appointmentDate,
            appointmentTime: req.body.appointmentTime
        }),
        null,
        res
    );
    if (!res.headersSent) {
        res.redirect('/dashboard');
    }
});

app.get('/delete/:id', requireLogin, async (req, res) => {
    await handleDbOperation(
        async () => await Data.findByIdAndDelete(req.params.id),
        null,
        res
    );
    if (!res.headersSent) {
        res.redirect('/dashboard');
    }
});

// Feedback Routes
app.get('/feedback', requireLogin, async (req, res) => {
    const feedbacks = await handleDbOperation(
        async () => await Feedback.find().sort({ createdAt: -1 }),
        [],
        res
    );
    if (!res.headersSent) {
        res.render('feedback', { feedbacks });
    }
});

app.post('/feedback', requireLogin, async (req, res) => {
    await handleDbOperation(
        async () => {
            const newFeedback = new Feedback({
                name: req.body.name,
                email: req.body.email,
                rating: req.body.rating,
                message: req.body.message
            });
            await newFeedback.save();
            return true;
        },
        false,
        res
    );
    if (!res.headersSent) {
        res.redirect('/dashboard');
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.use('/api/appointments', appointmentRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/leads', leadRoutes);




































