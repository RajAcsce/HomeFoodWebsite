const express = require('express');
const bodyParser = require('body-parser');
const session = require('cookie-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../')));
app.use(session({
    name: 'session',
    keys: ['secret-key'], // Change in production
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

// Admin Seeding & Server Start
const ADMIN_USERNAME = 'ADMIN';
const ADMIN_PASSWORD = 'Admin143'; // Default password

function seedAdmin() {
    const existing = db.findOne('admins', a => a.username === ADMIN_USERNAME);
    if (!existing) {
        const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
        db.insert('admins', { username: ADMIN_USERNAME, password_hash: hash });
        console.log(`Admin seeded. Username: ${ADMIN_USERNAME}`);
    }
}

// Authentication Middleware
const requireAdmin = (req, res, next) => {
    if (req.session && req.session.adminId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized: Admin access required' });
};

const requireUser = (req, res, next) => {
    if (req.session && req.session.userMobile) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized: User login required' });
};

// --- API ROUTES ---

// --- ADMIN API ROUTES ---
const adminRouter = express.Router();
adminRouter.use(requireAdmin);

// Logger
adminRouter.use((req, res, next) => {
    console.log(`[DEBUG] Admin Request: ${req.method} ${req.url}`);
    next();
});

// Admin: Revenue Breakdown
adminRouter.get('/revenue/breakdown', (req, res) => {
    const orders = db.findAll('orders', o => o.status !== 'Cancelled');
    let cash = 0;
    let upi = 0;
    let pending = 0;

    orders.forEach(o => {
        const p = db.findOne('payments', pay => pay.order_id === o.id);
        const amountPaid = p ? (p.amount_paid || 0) : 0;
        const total = o.total_amount || 0;

        if (p) {
            if (p.method === 'Cash') cash += amountPaid;
            if (p.method === 'UPI') upi += amountPaid;
        }

        if (total > amountPaid) {
            pending += (total - amountPaid);
        }
    });

    res.json({ cash, upi, pending });
});

// Admin: Daily Revenue
adminRouter.get('/revenue/daily', (req, res) => {
    const { startDate, endDate } = req.query;
    let start, end;

    if (startDate && endDate) {
        start = startDate;
        end = endDate;
    } else {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        start = d.toISOString().split('T')[0];
        end = new Date().toISOString().split('T')[0];
    }

    const startDt = new Date(start);
    const endDt = new Date(end);

    // Get all payments in range associated with non-cancelled orders
    const payments = db.findAll('payments', p => {
        if (!p.payment_date) return false;
        const pDate = new Date(p.payment_date.split('T')[0]);
        return pDate >= startDt && pDate <= endDt;
    });

    const dailyTotals = {};
    payments.forEach(p => {
        // Check order status
        const order = db.findOne('orders', o => o.id === p.order_id);
        if (order && order.status !== 'Cancelled') {
            const dateStr = p.payment_date.split('T')[0];
            dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + (p.amount_paid || 0);
        }
    });

    // Fill gaps
    const result = [];
    let current = new Date(start);
    while (current <= endDt) {
        const dateStr = current.toISOString().split('T')[0];
        result.push({ date: dateStr, total: dailyTotals[dateStr] || 0 });
        current.setDate(current.getDate() + 1);
    }

    res.json(result);
});

// Admin: User Orders
adminRouter.get('/users/:mobile/orders', (req, res) => {
    const { mobile } = req.params;
    const orders = db.findAll('orders', o => o.user_mobile === mobile);

    // Sort DESC
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const result = orders.map(o => {
        const p = db.findOne('payments', pay => pay.order_id === o.id);
        const items = db.findAll('order_items', i => i.order_id === o.id);
        return {
            ...o,
            payment_status: p ? p.status : 'Pending',
            amount_paid: p ? p.amount_paid : 0,
            items: items
        };
    });

    res.json(result);
});

// User: Update Order
app.put('/api/orders/:id', requireUser, (req, res) => {
    const { id } = req.params;
    const { items, total_amount, delivery_slot, delivery_date } = req.body;
    const mobile = req.session.userMobile;
    const orderId = parseInt(id);

    const order = db.findOne('orders', o => o.id === orderId && o.user_mobile === mobile);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const allowedStatuses = ['Pending', 'Accepted', 'Preparing'];
    if (!allowedStatuses.includes(order.status)) {
        return res.status(400).json({ error: `Cannot update order with status: ${order.status}` });
    }

    // 1. Update Order
    db.update('orders', o => o.id === orderId, {
        total_amount,
        delivery_slot,
        delivery_date
    });

    // 2. Update Payment Amount
    db.update('payments', p => p.order_id === orderId, { amount: total_amount });

    // 3. Replace Items
    db.delete('order_items', i => i.order_id === orderId);
    if (items && items.length > 0) {
        items.forEach(item => {
            db.insert('order_items', {
                order_id: orderId,
                product_id: item.id,
                product_name: item.name,
                quantity: item.quantity,
                unit_price: item.price,
                total_price: item.quantity * item.price
            });
        });
    }

    res.json({ message: 'Order updated successfully', orderId });
});

// Admin: Update User
adminRouter.put('/users/:mobile', (req, res) => {
    const { mobile } = req.params;
    const { name, alt_mobile, address } = req.body;

    db.update('users', u => u.mobile_number === mobile, {
        name,
        alt_mobile_number: alt_mobile,
        address
    });

    res.json({ message: 'User updated' });
});

// Admin: Delete User (Hard Delete)
adminRouter.delete('/users/:mobile', (req, res) => {
    const { mobile } = req.params;

    // Find all user orders
    const userOrders = db.findAll('orders', o => o.user_mobile === mobile);
    userOrders.forEach(o => {
        // Delete items
        db.delete('order_items', i => i.order_id === o.id);
        // Delete payments
        db.delete('payments', p => p.order_id === o.id);
    });

    // Delete orders
    db.delete('orders', o => o.user_mobile === mobile);

    // Delete user
    db.delete('users', u => u.mobile_number === mobile);

    res.json({ message: 'User and all related data deleted permanently' });
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const admin = db.findOne('admins', a => a.username === username);

    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

    if (bcrypt.compareSync(password, admin.password_hash)) {
        req.session.adminId = admin.id;
        res.json({ message: 'Login successful' });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
    req.session = null;
    res.json({ message: 'Logged out' });
});

// Public endpoint for Business Profile (no auth)
app.get('/api/admin/business-profile', (req, res) => {
    res.json(db.getBusinessInfo());
});
// Mount admin router
app.use('/api/admin', adminRouter);
app.use('/api/dashboard', adminRouter);

// User Login
app.post('/api/user/login', (req, res) => {
    const { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: 'Mobile number required' });

    let user = db.findOne('users', u => u.mobile_number === mobile);
    if (user) {
        req.session.userMobile = user.mobile_number;
        res.json({ message: 'Login successful', user, isNew: false });
    } else {
        user = db.insert('users', { mobile_number: mobile });
        req.session.userMobile = mobile;
        res.json({ message: 'Account created', user, isNew: true });
    }
});

// User Logout
app.post('/api/user/logout', (req, res) => {
    req.session = null;
    res.json({ message: 'Logged out' });
});

// Update User Profile
app.put('/api/user/profile', requireUser, (req, res) => {
    const { name, alt_mobile, address } = req.body;
    const mobile = req.session.userMobile;

    db.update('users', u => u.mobile_number === mobile, {
        name,
        alt_mobile_number: alt_mobile,
        address
    });
    res.json({ message: 'Profile updated' });
});

// Get User Profile
app.get('/api/user/profile', requireUser, (req, res) => {
    const mobile = req.session.userMobile;
    const user = db.findOne('users', u => u.mobile_number === mobile);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

// --- PRODUCTS API ---

// Public: Get All Products
app.get('/api/products', (req, res) => {
    const products = db.findAll('products', p => p.status !== 'Deleted');
    res.json(products);
});

// Admin: Add Product
app.post('/api/products', requireAdmin, (req, res) => {
    const { name, image_url, unit, quantity, description, price, status, food_type } = req.body;
    const defaultImageUrl = 'https://www.shutterstock.com/shutterstock/photos/2616578275/display_1500/stock-vector-knife-fork-and-plate-silhouette-icon-vector-illustration-2616578275.jpg';

    const product = db.insert('products', {
        name,
        image_url: (image_url && image_url.trim() !== '') ? image_url : defaultImageUrl,
        unit,
        quantity,
        description,
        price: parseFloat(price),
        status: status || 'Available',
        food_type: food_type || null
    });

    res.json({ id: product.id, message: 'Product added' });
});

// Admin: Update Product
app.put('/api/products/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { name, image_url, unit, quantity, description, price, status, food_type } = req.body;
    const defaultImageUrl = 'https://www.shutterstock.com/shutterstock/photos/2616578275/display_1500/stock-vector-knife-fork-and-plate-silhouette-icon-vector-illustration-2616578275.jpg';

    db.update('products', p => p.id == id, {
        name,
        image_url: (image_url && image_url.trim() !== '') ? image_url : defaultImageUrl,
        unit,
        quantity,
        description,
        price: parseFloat(price),
        status,
        food_type: food_type || null
    });

    res.json({ message: 'Product updated' });
});

// Admin: Delete Product
app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    db.update('products', p => p.id == id, { status: 'Deleted' });
    res.json({ message: 'Product deleted' });
});

// --- ORDERS API ---

app.post('/api/orders', requireUser, (req, res) => {
    const { items, total_amount, delivery_slot, delivery_date } = req.body;
    const mobile = req.session.userMobile; // '0000000000'; // For testing without login if needed

    if (!items || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });

    // Create Order
    const order = db.insert('orders', {
        user_mobile: mobile,
        total_amount: parseFloat(total_amount),
        delivery_slot,
        delivery_date: delivery_date || null,
        status: 'Pending'
    });

    // Create Items
    items.forEach(item => {
        db.insert('order_items', {
            order_id: order.id,
            product_id: item.id,
            product_name: item.name,
            quantity: item.quantity,
            unit_price: item.price,
            total_price: item.quantity * item.price
        });
    });

    // Create Payment
    db.insert('payments', {
        order_id: order.id,
        amount: parseFloat(total_amount),
        status: 'Pending',
        method: 'Cash/UPI' // Default placeholder
    });

    res.json({ message: 'Order placed', orderId: order.id });
});

// User: My Orders
app.get('/api/my-orders', requireUser, (req, res) => {
    const mobile = req.session.userMobile;
    const orders = db.findAll('orders', o => o.user_mobile === mobile);

    // Sort DESC
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const result = orders.map(o => {
        const p = db.findOne('payments', pay => pay.order_id === o.id);
        const items = db.findAll('order_items', i => i.order_id === o.id);

        // Attach product unit if available
        const itemsWithUnits = items.map(i => {
            const prod = db.findOne('products', prod => prod.id === i.product_id);
            return { ...i, unit: prod ? prod.unit : '' };
        });

        return {
            ...o,
            payment_status: p ? p.status : 'Pending',
            amount_paid: p ? p.amount_paid : 0,
            items: itemsWithUnits
        };
    });

    res.json(result);
});

// Admin: All Orders
adminRouter.get('/orders', (req, res) => {
    const orders = db.findAll('orders');
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const result = orders.map(o => {
        const user = db.findOne('users', u => u.mobile_number === o.user_mobile) || {};
        const p = db.findOne('payments', pay => pay.order_id === o.id) || {};

        return {
            ...o,
            user_name: user.name,
            user_address: user.address,
            payment_status: p.status,
            amount_paid: p.amount_paid
        };
    });

    res.json(result);
});

// Get Single Order
app.get('/api/orders/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const order = db.findOne('orders', o => o.id === id);

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Auth check
    const mobile = req.session.userMobile;
    const adminId = req.session.adminId;

    if (adminId || (mobile && mobile === order.user_mobile)) {
        const items = db.findAll('order_items', i => i.order_id === id);
        const payment = db.findOne('payments', p => p.order_id === id);
        const user = db.findOne('users', u => u.mobile_number === order.user_mobile);

        const itemsWithUnits = items.map(i => {
            const prod = db.findOne('products', prod => prod.id === i.product_id);
            return { ...i, unit: prod ? prod.unit : '' };
        });

        res.json({ order, items: itemsWithUnits, payment, user });
    } else {
        res.status(403).json({ error: 'Forbidden' });
    }
});

// Admin: Update Status
app.put('/api/orders/:id/status', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    db.update('orders', o => o.id === id, { status });
    res.json({ message: 'Status updated' });
});

// Admin: Update Payment
app.post('/api/orders/:id/payment', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const { status, amount, amount_paid, method, transaction_id, app_name } = req.body;

    db.update('payments', p => p.order_id === id, {
        status,
        amount,
        amount_paid,
        method,
        transaction_id,
        app_name
    });

    res.json({ message: 'Payment updated' });
});

// Admin: Stats
adminRouter.get('/stats', (req, res) => {
    const usersCount = db.findAll('users').length;
    const ordersCount = db.findAll('orders').length;
    const prodCount = db.findAll('products', p => p.status !== 'Deleted').length;

    // Total Revenue (Paid status, non-cancelled orders)
    // Actually, SQL was: WHERE p.status = 'Paid' AND o.status != 'Cancelled'
    let totalRevenue = 0;
    const payments = db.findAll('payments', p => p.status === 'Paid');
    payments.forEach(p => {
        const o = db.findOne('orders', order => order.id === p.order_id);
        if (o && o.status !== 'Cancelled') {
            totalRevenue += (p.amount_paid || 0);
        }
    });

    // Today's stats
    const today = new Date().toISOString().split('T')[0];
    const todaysOrders = db.findAll('orders', o => o.created_at.startsWith(today));

    let todayRev = 0;
    todaysOrders.forEach(o => {
        const p = db.findOne('payments', pay => pay.order_id === o.id);
        if (p) todayRev += (p.amount_paid || 0);
    });

    const todaysOrdersList = todaysOrders.map(o => {
        const u = db.findOne('users', user => user.mobile_number === o.user_mobile);
        const i = db.findAll('order_items', it => it.order_id === o.id);
        return { ...o, user_name: u ? u.name : '', items: i };
    });
    // Sort Newest first
    todaysOrdersList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Status Chart
    const statusCounts = {};
    db.findAll('orders').forEach(o => {
        statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    });
    const statusChart = Object.keys(statusCounts).map(k => ({ status: k, count: statusCounts[k] }));

    res.json({
        users: usersCount,
        orders: ordersCount,
        revenue: totalRevenue,
        products: prodCount,
        today_orders_count: todaysOrders.length,
        today_revenue: todayRev,
        today_orders: todaysOrdersList.slice(0, 10),
        status_chart: statusChart
    });
});

// Admin: Users list stats
adminRouter.get('/users', (req, res) => {
    const users = db.findAll('users', u => (!u.status || u.status !== 'Deleted'));

    const result = users.map(u => {
        const orders = db.findAll('orders', o => o.user_mobile === u.mobile_number);
        let totalBill = 0;
        let totalPaid = 0;

        orders.forEach(o => {
            totalBill += (o.total_amount || 0);
            const p = db.findOne('payments', pay => pay.order_id === o.id);
            if (p) totalPaid += (p.amount_paid || 0);
        });

        return {
            mobile_number: u.mobile_number,
            name: u.name,
            alt_mobile_number: u.alt_mobile_number,
            address: u.address,
            total_orders: orders.length,
            total_bill_amount: totalBill,
            total_paid_amount: totalPaid,
            total_remaining: totalBill - totalPaid
        };
    });

    // Sort by total orders desc
    result.sort((a, b) => b.total_orders - a.total_orders);
    res.json(result);
});

// Public endpoint moved earlier (removed duplicate)
// Admin: Business Profile (GET) – accessible via /api/admin/business-profile
adminRouter.get('/business-profile', (req, res) => {
    res.json(db.getBusinessInfo());
});

// Admin: Save Business Profile (POST)
// Note: No Multer, strictly JSON body now
adminRouter.post('/business-profile', (req, res) => {
    const {
        name, address, contact_number,
        delivery_charge, handling_charge,
        open_time, close_time,
        break_start, break_end,
        weekly_holiday, cart_value,
        shop_image_url, licence_doc_url // New fields accepting URLs
    } = req.body;

    const existing = db.getBusinessInfo();

    db.insert('business_info', {
        name,
        address,
        contact_number,
        delivery_charge: parseFloat(delivery_charge || 0),
        handling_charge: parseFloat(handling_charge || 0),
        shop_image_url: shop_image_url || existing.shop_image_url,
        licence_doc_url: licence_doc_url || existing.licence_doc_url,
        open_time,
        close_time,
        break_start,
        break_end,
        weekly_holiday,
        cart_value: parseFloat(cart_value || 1000)
    });

    res.json({ message: 'Profile saved' });
});

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start
seedAdmin();
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
