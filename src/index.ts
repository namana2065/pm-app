import dotenv from "dotenv";
dotenv.config();

console.log(process.env.SUPABASE_URL);
console.log(process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 20));

import { createApp } from "./app";

const PORT = process.env.PORT ?? 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
