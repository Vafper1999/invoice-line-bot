// Backend API สำหรับระบบสร้างใบแจ้งหนี้
// Node.js + Express + LINE Messaging API

const express = require('express');
const cors = require('cors');
const { Client } = require('@line/bot-sdk');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // สำหรับ serve static files

// LINE Bot configuration
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN',
    channelSecret: process.env.LINE_CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET'
};

const client = new Client(config);

// In-memory storage (ใน production ใช้ database จริง)
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

// Helper Functions
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
                            "uri": `${process.env.WEBAPP_URL || 'https://yourdomain.com/liff/payment'}?orderId=${id}`
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
app.get('/api/products', (req, res) => {
    res.json(products);
});

app.post('/api/products', (req, res) => {
    const { name, price, size, weight } = req.body;
    
    if (!name || !price) {
        return res.status(400).json({ error: 'Name and price are required' });
    }

    const newProduct = {
        id: Date.now(),
        name,
        price: parseInt(price),
        size: size || '',
        weight: parseInt(weight) || 0,
        createdAt: new Date()
    };

    products.push(newProduct);
    res.status(201).json(newProduct);
});

app.delete('/api/products/:id', (req, res) => {
    const productId = parseInt(req.params.id);
    products = products.filter(p => p.id !== productId);
    res.json({ message: 'Product deleted successfully' });
});

// Orders API
app.get('/api/orders', (req, res) => {
    res.json(orders);
});

app.get('/api/orders/:id', (req, res) => {
    const orderId = parseInt(req.params.id);
    const order = orders.find(o => o.id === orderId);
    
    if (!order) {
        return res.status(404).json({ error: 'Order not found' });
    }

    // Check if order is expired
    const now = new Date();
    if (now > order.expiresAt && order.status === 'active') {
        order.status = 'expired';
    }

    res.json(order);
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customerLineId, products: orderProducts, shipping } = req.body;

        if (!customerLineId || !orderProducts || orderProducts.length === 0) {
            return res.status(400).json({ error: 'Customer LINE ID and products are required' });
        }

        // Calculate total
        const subtotal = orderProducts.reduce((sum, item) => {
            const product = products.find(p => p.id === item.productId);
            return sum + (product.price * item.quantity);
        }, 0);

        const total = subtotal + (shipping || 0);

        // Create order
        const newOrder = {
            id: generateOrderId(),
            customerLineId,
            products: orderProducts.map(item => {
                const product = products.find(p => p.id === item.productId);
                return {
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    quantity: item.quantity
                };
            }),
            shipping: shipping || 0,
            total,
            status: 'active',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        };

        orders.push(newOrder);

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
        const orderId = parseInt(req.params.id);
        const order = orders.find(o => o.id === orderId);

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'active') {
            return res.status(400).json({ error: 'Cannot cancel this order' });
        }

        // Update order status
        order.status = 'cancelled';

        // Send cancellation message
        const cancellationMessage = generateCancellationMessage(orderId);
        await client.pushMessage(order.customerLineId, cancellationMessage);

        res.json(order);

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

    // Simple auto-reply for demo
    const echo = {
        type: 'text',
        text: `สวัสดีครับ! ขอบคุณสำหรับข้อความ: "${event.message.text}"\n\nทางร้านจะติดต่อกลับไปเร็วๆ นี้ครับ 😊`
    };

    return client.replyMessage(event.replyToken, echo);
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        orders: orders.length,
        products: products.length
    });
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
});

module.exports = app;