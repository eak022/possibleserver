const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

module.exports = (app) => {
  // แทนที่ URL ด้วยค่าจาก environment
  const customSwaggerDoc = {
    ...swaggerDocument,
    servers: [
      {
        url: "{protocol}://{host}",
        description: "API Server",
        variables: {
          protocol: {
            enum: ["http", "https"],
            default: "http",
            description: "โปรโตคอลที่ใช้ในการเชื่อมต่อ"
          },
          host: {
            enum: ["localhost:5000", "possibleserver.onrender.com"],
            default: "localhost:5000",
            description: "เซิร์ฟเวอร์ที่ใช้งาน (development หรือ production)"
          }
        }
      }
    ]
  };

  const swaggerOptions = {
    explorer: true,
    swaggerOptions: {
      displayRequestDuration: true,
      docExpansion: 'none',
      filter: true,
      showCommonExtensions: true
    }
  };

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(customSwaggerDoc, swaggerOptions));
};