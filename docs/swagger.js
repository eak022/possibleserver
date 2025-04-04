const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

// กำหนด URL จาก environment variables
const getServerUrl = () => {
  return process.env.NODE_ENV === 'production'
    ? process.env.PROD_API_URL
    : process.env.DEV_API_URL;
};

module.exports = (app) => {
  // แทนที่ URL ด้วยค่าจาก environment
  const customSwaggerDoc = {
    ...swaggerDocument,
    servers: [
      {
        url: getServerUrl(),
        description: process.env.NODE_ENV === 'production' ? 'Production Server' : 'Development Server'
      }
    ]
  };

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(customSwaggerDoc));
};