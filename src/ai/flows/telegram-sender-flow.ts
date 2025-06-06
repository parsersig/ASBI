
'use server';
/**
 * @fileOverview Flow for sending messages via Telegram Bot API.
 *
 * - sendTelegramMessage - Sends a message using a Telegram bot.
 * - SendTelegramMessageInput - Input type for the sendTelegramMessage function.
 * - SendTelegramMessageOutput - Return type for the sendTelegramMessage function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Schemas are not exported as per "use server" constraints
const SendTelegramMessageInputSchema = z.object({
  chatId: z.string().describe('The target chat ID (numeric, e.g., -1001234567890 for groups/channels, or a positive number for users) or username (e.g., @channelname). For private chats with users, a numeric chat ID is usually required.'),
  messageText: z.string().describe('The content of the message to send.'),
});
export type SendTelegramMessageInput = z.infer<typeof SendTelegramMessageInputSchema>;

const SendTelegramMessageOutputSchema = z.object({
  success: z.boolean().describe('Whether the message was sent successfully.'),
  message: z.string().describe('A status message (e.g., "Сообщение отправлено" or error details).'),
  telegramResponse: z.any().optional().describe('The full response from Telegram API for debugging.'),
});
export type SendTelegramMessageOutput = z.infer<typeof SendTelegramMessageOutputSchema>;

export async function sendTelegramMessage(input: SendTelegramMessageInput): Promise<SendTelegramMessageOutput> {
  console.log('[Server Action] sendTelegramMessage invoked with input:', JSON.stringify(input));
  try {
    // Проверяем, что sendTelegramMessageFlow действительно функция (определена Genkit)
    // Эта проверка важна, так как в среде Vercel инициализация Genkit может проходить иначе.
    if (typeof sendTelegramMessageFlow !== 'function') {
        console.error('[Server Action CRITICAL] sendTelegramMessageFlow is not a function. Genkit flow definition might have failed during server startup. Check Vercel deployment logs for Genkit initialization errors.');
        // Возвращаем стандартизированный ответ об ошибке, чтобы клиент не падал
        return {
            success: false,
            message: 'Критическая ошибка сервера: Flow не определен. Проверьте логи сервера Vercel.',
            telegramResponse: { error: 'Flow definition failed' },
        };
    }

    const result = await sendTelegramMessageFlow(input);
    console.log('[Server Action] sendTelegramMessageFlow returned:', JSON.stringify(result));
    return result;
  } catch (error: any) {
    // Этот блок ловит ошибки, которые могли произойти при *вызове* flow или если flow сам бросил исключение
    console.error('[Server Action CRITICAL] Unhandled error in sendTelegramMessage server action:', error.message, error.stack);
    const digest = error.digest || 'N/A';
    console.error('[Server Action CRITICAL] Error Digest:', digest);
    return {
      success: false,
      message: `Произошла критическая серверная ошибка при вызове flow. Digest: ${digest}. Подробности в логах сервера Vercel.`,
      telegramResponse: { error: error.message, digest: digest },
    };
  }
}

const sendTelegramMessageFlow = ai.defineFlow(
  {
    name: 'sendTelegramMessageFlow',
    inputSchema: SendTelegramMessageInputSchema,
    outputSchema: SendTelegramMessageOutputSchema,
  },
  async ({ chatId, messageText }) => {
    console.log(`[Genkit Flow - sendTelegramMessageFlow] Starting for chatId: ${chatId}. Message: "${messageText.substring(0, 50)}..."`);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const genkitEnv = process.env.GENKIT_ENV; // 'prod' or 'dev'
    const nodeEnv = process.env.NODE_ENV; // 'production' or 'development'

    console.log(`[Genkit Flow - sendTelegramMessageFlow] Environment check: GENKIT_ENV=${genkitEnv}, NODE_ENV=${nodeEnv}`);
    
    if (!botToken) {
      const serverTypeDetail = genkitEnv === 'dev' || nodeEnv === 'development' 
          ? "в локальном .env.local" 
          : "в переменных окружения Vercel для Deployment (Production)";
      const errorMessage = `Ошибка конфигурации: TELEGRAM_BOT_TOKEN не найден ${serverTypeDetail}. Убедитесь, что он правильно установлен.`;
      console.error(`[Genkit Flow - sendTelegramMessageFlow] CRITICAL: ${errorMessage}`);
      return {
        success: false,
        message: errorMessage,
      };
    }
    // Логируем только часть токена для подтверждения, что он есть, но не сам токен
    console.log(`[Genkit Flow - sendTelegramMessageFlow] TELEGRAM_BOT_TOKEN found (starts with: ${botToken.substring(0, botToken.indexOf(':'))}:...).`);

    const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    console.log(`[Genkit Flow - sendTelegramMessageFlow] Attempting to send to API URL (token hidden): https://api.telegram.org/bot<TOKEN_HIDDEN>/sendMessage`);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageText,
          // parse_mode: 'HTML', // Опционально, если вы хотите использовать HTML-разметку в сообщениях
        }),
      });

      const responseData = await response.json();
      console.log('[Genkit Flow - sendTelegramMessageFlow] Telegram API response status:', response.status);
      console.log('[Genkit Flow - sendTelegramMessageFlow] Telegram API response data:', JSON.stringify(responseData));


      if (response.ok && responseData.ok) {
        return {
          success: true,
          message: 'Сообщение успешно отправлено в Telegram.',
          telegramResponse: responseData,
        };
      } else {
        console.error('[Genkit Flow - sendTelegramMessageFlow] Telegram API Error:', responseData);
        const errorDescription = responseData.description || `HTTP status ${response.status}`;
        const errorCode = responseData.error_code ? ` (Код: ${responseData.error_code})` : '';
        let detailedMessage = `Ошибка Telegram API: ${errorDescription}${errorCode}. Проверьте правильность ID чата/имени пользователя и токен бота.`;

        if (responseData.error_code === 400 && errorDescription.toLowerCase().includes('chat not found')) {
            detailedMessage += ' Убедитесь, что бот является участником указанного чата (группы/канала) и имеет права на отправку сообщений. Для каналов бот должен быть администратором с правом публикации.';
        } else if (responseData.error_code === 403 && errorDescription.toLowerCase().includes('bot was blocked by the user')) {
            detailedMessage += ' Пользователь заблокировал бота, или бот был удален из чата/канала.';
        } else if (responseData.error_code === 403) { // General forbidden
             detailedMessage += ' Убедитесь, что бот имеет необходимые разрешения для отправки сообщений в этот чат (например, не заблокирован пользователем или имеет права в группе/канале).';
        } else if (responseData.error_code === 401 && errorDescription.toLowerCase().includes('unauthorized')) { // Unauthorized
            detailedMessage += ' Неверный токен бота. Проверьте значение TELEGRAM_BOT_TOKEN в переменных окружения Vercel.';
        }


        return {
          success: false,
          message: detailedMessage,
          telegramResponse: responseData,
        };
      }
    } catch (error: any) {
      // Этот блок ловит ошибки сети или если fetch сам по себе упал
      console.error('[Genkit Flow - sendTelegramMessageFlow] Network or fetch execution error:', error.message, error.stack);
      return {
        success: false,
        message: `Сетевая ошибка или ошибка выполнения запроса к Telegram: ${error.message || 'Неизвестная ошибка при связи с Telegram.'}`,
        telegramResponse: { error: error.message, stack: error.stack },
      };
    }
  }
);
