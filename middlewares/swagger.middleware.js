const swaggerMiddleware = (req, res, next) => {
    const FRONTEND_URL = process.env.FRONTEND_URL;
    const API_URL = process.env.NODE_ENV === 'production' 
      ? process.env.PROD_API_URL 
      : process.env.DEV_API_URL;
  
    // เพิ่ม possibleserver.onrender.com ในรายการที่อนุญาต
    const allowedOrigins = [
      FRONTEND_URL, 
      API_URL, 
      'https://possibleserver.onrender.com',
      'wss://possibleserver.onrender.com'
    ];
    
    const origin = req.headers.origin;
  
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  
    // เพิ่ม WebSocket protocol ใน allowed headers
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Sec-WebSocket-Protocol');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
  };
  
  module.exports = swaggerMiddleware;