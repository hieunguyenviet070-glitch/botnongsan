const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
  if (connected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI không được cấu hình trong môi trường.');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  connected = true;
}

mongoose.connection.on('disconnected', () => { connected = false; });
mongoose.connection.on('error', () => { connected = false; });

module.exports = { connectDB };
