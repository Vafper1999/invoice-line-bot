// Backend API สำหรับระบบสร้างใบแจ้งหนี้
// Node.js + Express + LINE Messaging API + Firebase

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Client } = require('@line/bot-sdk');
const admin = require('firebase-admin');
const cron = require('node-cron');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // สำหรับ serve static files

// Initialize Firebase Admin
let db = null;
let firebaseEnabled = false;

try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
    }
    
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    
    db = admin.firestore();
    firebaseEnabled = true;
    console.log('✅ Firebase initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.log('⚠️ Running without Firebase - using in-memory storage');
    firebaseEnabled = false;
}

// Collections (ปลอดภัยจาก null)
const productsCollection = firebaseEnabled ? db.collection('products') : null;
const ordersCollection = firebaseEnabled ? db.collection('orders') : null;
const customersCollection = firebaseEnabled ? db.collection('customers') : null;

// LINE Bot configuration
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN',
    channelSecret: process.env.LINE_CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET'
};

const client = new Client(config);

// In-memory storage (fallback เมื่อ Firebase ไม่ทำงาน)
let products = [
    {
        id: 1,
        name: "เสื้อยืดคอกลม",
        price: 299,
        size: "S, M, L, XL",
        weight: 200,
        createdAt: new Date()
    },
    {
        id: 2,
        name: "กางเกงยีนส์",
        price: 590,
        size: "28-36",
        weight: 500,
        createdAt: new Date()
    }
];

let orders = [];
let orderIdCounter = 1000;
let customers = [];

// Firebase Helper Functions
async function addProduct(productData) {
    if (firebaseEnabled && productsCollection) {
        try {
            const docRef = await productsCollection.add({
                ...productData,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return { id: docRef.id, ...productData };
        } catch (error) {
            console.error('Error adding product to Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    const newProduct = {
        id: Date.now(),
        ...productData,
        createdAt: new Date()
    };
    products.push(newProduct);
    return newProduct;
}

async function getProducts() {
    if (firebaseEnabled && productsCollection) {
        try {
            const snapshot = await productsCollection.orderBy('createdAt', 'desc').get();
            const firebaseProducts = [];
            
            snapshot.forEach(doc => {
                const data = doc.data();
                firebaseProducts.push({
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt?.toDate()
                });
            });
            
            return firebaseProducts;
        } catch (error) {
            console.error('Error getting products from Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    return products;
}

async function deleteProduct(productId) {
    if (firebaseEnabled && productsCollection) {
        try {
            await productsCollection.doc(productId).delete();
            return { message: 'Product deleted from Firebase' };
        } catch (error) {
            console.error('Error deleting product from Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    const numericId = parseInt(productId);
    products = products.filter(p => p.id !== numericId && p.id !== productId);
    return { message: 'Product deleted from memory' };
}

async function addCustomer(customerData) {
    if (firebaseEnabled && customersCollection) {
        try {
            // ตรวจสอบว่ามีลูกค้าอยู่แล้วไหม
            const existingCustomer = await customersCollection
                .where('userId', '==', customerData.userId)
                .get();
            
            if (!existingCustomer.empty) {
                // อัพเดตข้อมูลลูกค้าเดิม
                const doc = existingCustomer.docs[0];
                await doc.ref.update({
                    displayName: customerData.displayName,
                    pictureUrl: customerData.pictureUrl,
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
                    messageCount: admin.firestore.FieldValue.increment(1)
                });
                
                const data = doc.data();
                return { 
                    id: doc.id, 
                    ...customerData,
                    messageCount: (data.messageCount || 0) + 1
                };
            } else {
                // เพิ่มลูกค้าใหม่
                const docRef = await customersCollection.add({
                    ...customerData,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
                    messageCount: 1
                });
                
                return { id: docRef.id, ...customerData, messageCount: 1 };
            }
        } catch (error) {
            console.error('Error adding customer to Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    let customer = customers.find(c => c.userId === customerData.userId);
    if (customer) {
        customer.displayName = customerData.displayName;
        customer.pictureUrl = customerData.pictureUrl;
        customer.lastSeen = new Date();
        customer.messageCount += 1;
        return customer;
    } else {
        const newCustomer = {
            id: Date.now(),
            ...customerData,
            createdAt: new Date(),
            lastSeen: new Date(),
            messageCount: 1
        };
        customers.push(newCustomer);
        return newCustomer;
    }
}

async function getCustomers() {
    if (firebaseEnabled && customersCollection) {
        try {
            const snapshot = await customersCollection
                .orderBy('lastSeen', 'desc')
                .get();
            
            const firebaseCustomers = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                firebaseCustomers.push({
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt?.toDate(),
                    lastSeen: data.lastSeen?.toDate()
                });
            });
            
            return firebaseCustomers;
        } catch (error) {
            console.error('Error getting customers from Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    return customers;
}

async function createOrder(orderData) {
    if (firebaseEnabled && ordersCollection) {
        try {
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            
            const order = {
                ...orderData,
                status: 'active',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: expiresAt
            };
            
            const docRef = await ordersCollection.add(order);
            
            return { 
                id: docRef.id, 
                ...order,
                expiresAt: expiresAt,
                createdAt: new Date()
            };
        } catch (error) {
            console.error('Error creating order in Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    const newOrder = {
        id: generateOrderId(),
        ...orderData,
        status: 'active',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    };
    orders.push(newOrder);
    return newOrder;
}

async function getOrders() {
    if (firebaseEnabled && ordersCollection) {
        try {
            const snapshot = await ordersCollection
                .orderBy('createdAt', 'desc')
                .get();
            
            const firebaseOrders = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                firebaseOrders.push({
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt?.toDate(),
                    expiresAt: data.expiresAt?.toDate()
                });
            });
            
            return firebaseOrders;
        } catch (error) {
            console.error('Error getting orders from Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    return orders;
}

async function getOrder(orderId) {
    if (firebaseEnabled && ordersCollection) {
        try {
            const doc = await ordersCollection.doc(orderId).get();
            
            if (doc.exists) {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    createdAt: data.createdAt?.toDate(),
                    expiresAt: data.expiresAt?.toDate()
                };
            }
        } catch (error) {
            console.error('Error getting order from Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    const numericId = parseInt(orderId);
    return orders.find(o => o.id === numericId || o.id === orderId);
}

async function cancelOrder(orderId) {
    if (firebaseEnabled && ordersCollection) {
        try {
            await ordersCollection.doc(orderId).update({
                status: 'cancelled',
                cancelledAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return { message: 'Order cancelled in Firebase' };
        } catch (error) {
            console.error('Error cancelling order in Firebase:', error);
            // Fallback to memory
        }
    }
    
    // In-memory fallback
    const numericId = parseInt(orderId);
    const order = orders.find(o => o.id === numericId || o.id === orderId);
    if (order) {
        order.status = 'cancelled';
        order.cancelledAt = new Date();
        return { message: 'Order cancelled in memory' };
    }
    
    throw new Error('Order not found');
}

// Helper functions
function generateOrderId() {
    return ++orderIdCounter;
}

function generateFlexMessage(orderData) {
    const { id, products, shipping, total, expiresAt } = orderData;
    
    const productComponents = products.map(product => ({
        "type": "box",
        "layout": "horizontal",
        "contents": [
            {
                "type": "text",
                "text": product.name,
                "size": "sm",
                "color": "#555555",
                "flex": 0
            },
            {
                "type": "text",
                "text": `×${product.quantity}`,
                "size": "sm",
                "color": "#111111",
                "align": "end",
                "flex": 0,
                "margin": "md"
            },
            {
                "type": "text",
                "text": `${(product.price * product.quantity).toLocaleString()}฿`,
                "size": "sm",
                "color": "#111111",
                "align": "end"
            }
        ]
    }));

    const productList = [];
    productComponents.forEach((component, index) => {
        productList.push(component);
        if (index < productComponents.length - 1) {
            productList.push({
                "type": "separator",
                "margin": "md"
            });
        }
    });

    const flexMessage = {
        "type": "flex",
        "altText": `ใบแจ้งหนี้ #${id} - ยอดรวม ${total.toLocaleString()} บาท`,
        "contents": {
            "type": "bubble",
            "size": "kilo",
            "header": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "text",
                                "text": "🧾",
                                "size": "xl",
                                "flex": 0
                            },
                            {
                                "type": "text",
                                "text": "ใบแจ้งหนี้",
                                "weight": "bold",
                                "size": "xl",
                                "color": "#FFFFFF",
                                "margin": "md"
                            }
                        ]
                    },
                    {
                        "type": "text",
                        "text": `เลขที่: #${id}`,
                        "size": "sm",
                        "color": "#FFFFFF",
                        "margin": "sm"
                    }
                ],
                "backgroundColor": "#00C851",
                "paddingAll": "20px"
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "รายการสินค้า",
                        "weight": "bold",
                        "size": "md",
                        "color": "#333333"
                    },
                    {
                        "type": "separator",
                        "margin": "md"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "spacing": "sm",
                        "contents": productList
                    },
                    ...(shipping > 0 ? [
                        {
                            "type": "separator",
                            "margin": "xl"
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "margin": "lg",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "ค่าจัดส่ง",
                                    "size": "sm",
                                    "color": "#555555"
                                },
                                {
                                    "type": "text",
                                    "text": `${shipping.toLocaleString()}฿`,
                                    "size": "sm",
                                    "color": "#111111",
                                    "align": "end"
                                }
                            ]
                        }
                    ] : []),
                    {
                        "type": "separator",
                        "margin": "xl"
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "margin": "lg",
                        "contents": [
                            {
                                "type": "text",
                                "text": "ยอดรวมทั้งสิ้น",
                                "size": "md",
                                "weight": "bold",
                                "color": "#00C851"
                            },
                            {
                                "type": "text",
                                "text": `${total.toLocaleString()}฿`,
                                "size": "md",
                                "weight": "bold",
                                "color": "#00C851",
                                "align": "end"
                            }
                        ]
                    },
                    {
                        "type": "separator",
                        "margin": "xl"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": [
                            {
                                "type": "text",
                                "text": "⏰ หมดอายุ",
                                "size": "xs",
                                "color": "#FF4444",
                                "weight": "bold"
                            },
                            {
                                "type": "text",
                                "text": formatExpiryDate(expiresAt),
                                "size": "xs",
                                "color": "#666666",
                                "margin": "xs"
                            }
                        ]
                    }
                ],
                "paddingAll": "20px"
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    {
                        "type": "button",
                        "style": "primary",
                        "height": "md",
                        "action": {
                            "type": "uri",
                            "label": "💳 ชำระเงิน",
                            "uri": `${process.env.WEBAPP_URL || 'https://yourdomain.com'}/payment.html?orderId=${id}`
                        },
                        "color": "#00C851"
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "text",
                                "text": "💡 กดปุ่มข้างต้นเพื่อดูข้อมูลการชำระเงิน",
                                "size": "xs",
                                "color": "#999999",
                                "wrap": true,
                                "align": "center"
                            }
                        ]
                    }
                ],
                "paddingAll": "20px"
            }
        }
    };

    return flexMessage;
}

function generateCancellationMessage(orderId) {
    return {
        "type": "flex",
        "altText": `คำสั่งซื้อ #${orderId} ถูกยกเลิกแล้ว`,
        "contents": {
            "type": "bubble",
            "size": "micro",
            "header": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "❌ ยกเลิกคำสั่งซื้อ",
                        "weight": "bold",
                        "size": "lg",
                        "color": "#FFFFFF",
                        "align": "center"
                    }
                ],
                "backgroundColor": "#FF4444",
                "paddingAll": "20px"
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": `คำสั่งซื้อ #${orderId}`,
                        "weight": "bold",
                        "size": "md",
                        "color": "#333333",
                        "align": "center"
                    },
                    {
                        "type": "text",
                        "text": "ถูกยกเลิกโดยทางร้าน",
                        "size": "sm",
                        "color": "#666666",
                        "align": "center",
                        "margin": "sm"
                    },
                    {
                        "type": "separator",
                        "margin": "lg"
                    },
                    {
                        "type": "text",
                        "text": "หากมีข้อสงสัยกรุณาติดต่อทางร้าน",
                        "size": "sm",
                        "color": "#666666",
                        "align": "center",
                        "margin": "lg",
                        "wrap": true
                    }
                ],
                "paddingAll": "20px"
            }
        }
    };
}

function formatExpiryDate(date) {
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Bangkok'
    };
    return date.toLocaleDateString('th-TH', options);
}

// API Routes

// Products API
app.get('/api/products', async (req, res) => {
    try {
        const productsList = await getProducts();
        res.json(productsList);
    } catch (error) {
        console.error('Error getting products:', error);
        res.status(500).json({ error: 'Failed to get products' });
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const { name, price, size, weight } = req.body;
        
        if (!name || !price) {
            return res.status(400).json({ error: 'Name and price are required' });
        }

        const productData = {
            name,
            price: parseInt(price),
            size: size || '',
            weight: parseInt(weight) || 0
        };

        const newProduct = await addProduct(productData);
        res.status(201).json(newProduct);
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ error: 'Failed to add product' });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        const result = await deleteProduct(req.params.id);
        res.json(result);
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Customers API
app.get('/api/customers', async (req, res) => {
    try {
        const customersList = await getCustomers();
        res.json(customersList);
    } catch (error) {
        console.error('Error getting customers:', error);
        res.status(500).json({ error: 'Failed to get customers' });
    }
});

// Orders API
app.get('/api/orders', async (req, res) => {
    try {
        const ordersList = await getOrders();
        res.json(ordersList);
    } catch (error) {
        console.error('Error getting orders:', error);
        res.status(500).json({ error: 'Failed to get orders' });
    }
});

app.get('/api/orders/:id', async (req, res) => {
    try {
        const order = await getOrder(req.params.id);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Check if order is expired
        const now = new Date();
        if (now > order.expiresAt && order.status === 'active') {
            order.status = 'expired';
        }

        res.json(order);
    } catch (error) {
        console.error('Error getting order:', error);
        res.status(500).json({ error: 'Failed to get order' });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customerLineId, products: orderProducts, shipping } = req.body;

        if (!customerLineId || !orderProducts || orderProducts.length === 0) {
            return res.status(400).json({ error: 'Customer LINE ID and products are required' });
        }

        // Get current products list
        const currentProducts = await getProducts();

        // Calculate total
        const subtotal = orderProducts.reduce((sum, item) => {
            const product = currentProducts.find(p => p.id == item.productId);
            if (!product) {
                throw new Error(`Product with ID ${item.productId} not found`);
            }
            return sum + (product.price * item.quantity);
        }, 0);

        const total = subtotal + (shipping || 0);

        // Create order data
        const orderData = {
            customerLineId,
            products: orderProducts.map(item => {
                const product = currentProducts.find(p => p.id == item.productId);
                return {
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    quantity: item.quantity
                };
            }),
            shipping: shipping || 0,
            total
        };

        // Create order
        const newOrder = await createOrder(orderData);

        // Send LINE message
        const flexMessage = generateFlexMessage(newOrder);
        await client.pushMessage(customerLineId, flexMessage);

        res.status(201).json(newOrder);

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Failed to create order and send LINE message' });
    }
});

app.patch('/api/orders/:id/cancel', async (req, res) => {
    try {
        const order = await getOrder(req.params.id);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'active') {
            return res.status(400).json({ error: 'Cannot cancel this order' });
        }

        // Cancel order
        await cancelOrder(req.params.id);

        // Send cancellation message
        const cancellationMessage = generateCancellationMessage(order.id);
        await client.pushMessage(order.customerLineId, cancellationMessage);

        res.json({ message: 'Order cancelled successfully' });

    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({ error: 'Failed to cancel order' });
    }
});

// LINE Webhook (for receiving messages from LINE)
app.post('/api/webhook', (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook error:', err);
            res.status(500).end();
        });
});

async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const messageText = event.message.text;

    // บันทึกข้อมูลลูกค้าอัตโนมัติ
    try {
        let customerData = {
            userId: userId,
            displayName: 'Unknown User',
            pictureUrl: '',
            lastSeen: new Date(),
            messageCount: 1
        };

        // ดึงข้อมูล Profile จาก LINE
        try {
            const profile = await client.getProfile(userId);
            customerData.displayName = profile.displayName;
            customerData.pictureUrl = profile.pictureUrl;
            console.log('Customer profile loaded:', profile.displayName);
        } catch (error) {
            console.error('Cannot get profile:', error);
        }

        const customer = await addCustomer(customerData);

        // ตรวจสอบว่าเป็นคำสั่งพิเศษหรือไม่
        if (messageText.toLowerCase().includes('สวัสดี') || messageText.toLowerCase().includes('hello')) {
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `สวัสดีครับ คุณ${customer.displayName}! 😊\n\nยินดีให้บริการครับ มีอะไรสอบถามได้เลยครับ`
            });
        }

        // ส่งข้อความต่อไป Dialogflow (วิธีง่ายๆ ก่อน)
        const echo = {
            type: 'text',
            text: `สวัสดีครับ คุณ${customer.displayName}! 😊\n\nขอบคุณสำหรับข้อความ: "${messageText}"\n\nทางร้านจะติดต่อกลับไปเร็วๆ นี้ครับ`
        };

        return client.replyMessage(event.replyToken, echo);

    } catch (error) {
        console.error('Error handling LINE event:', error);
        
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'ขออภัยครับ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
        });
    }
}

// Auto cleanup ทุกชั่วโมง (ถ้า Firebase ทำงาน)
if (firebaseEnabled) {
    cron.schedule('0 * * * *', async () => {
        console.log('🧹 Running auto cleanup...');
        
        try {
            const now = new Date();
            
            // ลบใบแจ้งหนี้ที่หมดอายุ (24 ชม.)
            const expiredOrdersQuery = await ordersCollection
                .where('expiresAt', '<=', now)
                .where('status', '==', 'active')
                .get();
            
            let expiredCount = 0;
            const expiredBatch = db.batch();
            
            expiredOrdersQuery.forEach(doc => {
                expiredBatch.update(doc.ref, { status: 'expired' });
                expiredCount++;
            });
            
            if (expiredCount > 0) {
                await expiredBatch.commit();
                console.log(`⏰ Marked ${expiredCount} orders as expired`);
            }
            
            console.log('✅ Auto cleanup completed');
            
        } catch (error) {
            console.error('❌ Auto cleanup failed:', error);
        }
    });
}

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const ordersList = await getOrders();
        const productsList = await getProducts();
        
        res.json({ 
            status: 'OK', 
            firebase: firebaseEnabled ? 'Connected' : 'Disabled',
            timestamp: new Date().toISOString(),
            orders: ordersList.length,
            products: productsList.length
        });
    } catch (error) {
        console.error('Error in health check:', error);
        res.status(500).json({ 
            status: 'ERROR', 
            firebase: firebaseEnabled ? 'Connected' : 'Disabled',
            timestamp: new Date().toISOString() 
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📋 Admin Panel: http://localhost:${port}`);
    console.log(`🔗 API Endpoint: http://localhost:${port}/api`);
    console.log(`💬 LINE Webhook: http://localhost:${port}/api/webhook`);
    console.log(`🔥 Firebase: ${firebaseEnabled ? 'Enabled' : 'Disabled (using memory storage)'}`);
});

module.exports = app;