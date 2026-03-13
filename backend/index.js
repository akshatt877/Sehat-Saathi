import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import OpenAI from "openai";
import mainRoutes from "./routes/main.js";
import protectedRoutes from "./routes/protected.js";
import Appointment from "./models/Appointment.js";
import User from "./models/User.js";
import authRoutes from "./routes/auth.js";
import prescriptionRoutes from "./routes/prescriptionRoutes.js";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import initSocket from "./services/socket.js";
// import Ragroutes from "./routes/ragRoutes.js";
import os from "os";   // âœ… Added to detect IPv4

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// âœ… MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/medimitra';
mongoose.connect(MONGO_URI)
  .then(() => console.log("âœ… Connected to MongoDB", mongoose.connection.name))
  .catch((err) => {
    console.error("âŒ MongoDB connection error:", err.message);
    console.log("âš ï¸ Server will continue without MongoDB connection");
  });

// âœ… CORS config - Allow frontend development server
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
}));

app.use(bodyParser.json());
app.use(cookieParser());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api", mainRoutes);
app.use("/api", protectedRoutes);
app.use("/api", prescriptionRoutes);
// app.use("/api", Ragroutes);

// OpenAI client (GPT-4 powered)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => {
  res.status(200).json({
    "message": "Hey from backend of Sehat-Saathi",
    "ServerHealth": "Excellent"
  });
});

app.post("/api/gemini-agent", async (req, res) => {
  const { query, language } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    console.error("âŒ Missing OPENAI_API_KEY environment variable");
    return res.status(500).json({ reply: "AI à¤¸à¥‡à¤µà¤¾ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¬à¤¾à¤¦ à¤®à¥‡à¤‚ à¤ªà¥à¤°à¤¯à¤¾à¤¸ à¤•à¤°à¥‡à¤‚à¥¤" });
  }

  if (!query || !query.trim()) {
    return res.status(400).json({ reply: "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥‡ à¤²à¤•à¥à¤·à¤£ à¤¯à¤¾ à¤ªà¥à¤°à¤¶à¥à¤¨ à¤²à¤¿à¤–à¥‡à¤‚à¥¤" });
  }

  const languageMap = {
    hi: { name: "Hindi", script: "à¤¦à¥‡à¤µà¤¨à¤¾à¤—à¤°à¥€" },
    pa: { name: "Punjabi", script: "à¨—à©à¨°à¨®à©à¨–à©€" },
    en: { name: "English", script: "Latin" },
  };
  const normalizedLang = (language || "").toLowerCase();
  const languageMeta = languageMap[normalizedLang] || languageMap.en;

  const prompt = `You are a simple healthcare assistant for rural patients in Nabha, Punjab.
Always respond entirely in ${languageMeta.name} using the ${languageMeta.script} script. Do not switch languages.
Reply short, clear, and friendly.
Use Markdown with these sections:
1. Possible Causes
2. Basic Precautions
3. Simple Home/Traditional Remedies
4. Common OTC Medicines
5. When to See a Doctor
6. Serious Warning Signs
Do not copy the patient's words verbatim. Summarise their symptoms first, then give fresh guidance.`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini" || "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Patient details (language: ${languageMeta.name}): ${query}\nPlease analyse the symptoms above and respond with clear advice without repeating the exact phrases.` }
      ],
      temperature: 0.7
    });

    const response = completion.choices[0]?.message?.content?.trim() || "";
    res.json({ reply: response });
  } catch (error) {
    console.error("âŒ OpenAI request failed:", error?.message || error);
    res.status(500).json({ reply: "AI à¤¸à¥‡ à¤œà¤µà¤¾à¤¬ à¤¨à¤¹à¥€à¤‚ à¤®à¤¿à¤²à¤¾à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¬à¤¾à¤¦ à¤®à¥‡à¤‚ à¤ªà¥à¤°à¤¯à¤¾à¤¸ à¤•à¤°à¥‡à¤‚à¥¤" });
  }
});

app.get("/api/public-stats", async (_req, res) => {
  try {
    const [patients, doctors, completed] = await Promise.all([
      User.countDocuments({ role: "patient" }),
      User.countDocuments({ role: "doctor" }),
      Appointment.countDocuments({ status: "completed" })
    ]);

    res.json({
      patients,
      doctors,
      successfulAppointments: completed
    });
  } catch (error) {
    console.error("âŒ Failed to fetch public stats:", error?.message || error);
    res.status(500).json({
      patients: 0,
      doctors: 0,
      successfulAppointments: 0
    });
  }
});

// âœ… Socket.io setup
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
});
app.set("io", io);

// Init sockets
initSocket(io);

// Appointment completion
app.post("/api/appointments/complete", async (req, res) => {
  const { appointmentId } = req.body;
  try {
    const appointment = await Appointment.findByIdAndUpdate(appointmentId, { status: "completed" });
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });
    io.to(appointment.doctor.toString()).emit("queue:update", { appointmentId });
    res.status(200).json({ message: "Appointment marked as completed" });
  } catch {
    res.status(500).json({ message: "Failed to mark appointment as completed" });
  }
});

// âœ… Get system IPv4 automatically
function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// Start server
server.listen(PORT, () => {
  console.log(`ðŸš€ Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error('âŒ Server failed to start:', err.message);
});

