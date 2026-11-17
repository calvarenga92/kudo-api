import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configurarApp } from './configurar-app.js';
import { lerAmbiente } from './config/ambiente.js';

const ambiente = lerAmbiente();
const app = await NestFactory.create(AppModule);
configurarApp(app, ambiente.origensCors);
await app.listen(ambiente.porta);
