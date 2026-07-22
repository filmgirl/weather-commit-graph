import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  console.log(`[wcg] api listening on http://localhost:${port}`);
});
