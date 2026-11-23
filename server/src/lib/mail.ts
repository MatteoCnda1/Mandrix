import nodemailer from 'nodemailer';
import { env } from '../env.js';

const transport = env.smtpUrl ? nodemailer.createTransport(env.smtpUrl) : null;

export const mailEnabled = () => !!transport;

export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) return;
  await transport.sendMail({ from: env.mailFrom, to, subject, text });
}
