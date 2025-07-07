const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || "mongodb+srv://vikas007:Vikas123@cluster0.yykzc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    await mongoose.connect(uri);
    console.log("MongoDB Connected");
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;