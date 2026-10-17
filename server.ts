import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const port = process.env.PORT || 3000;

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  async function callGeminiFreeTier(payload: any) {
    // Modelos gratuitos e rápidos (Flash Lite e Flash)
    const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
    let lastError: any = null;

    for (const model of models) {
      try {
        const config: any = { ...payload.config };
        if (model === 'gemini-3.1-flash-lite' || model === 'gemini-3.8-flash') {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        }
        const res = await ai.models.generateContent({
          ...payload,
          model,
          config,
        });
        return res;
      } catch (err: any) {
        lastError = err;
        console.warn(`Modelo ${model} indisponível no momento:`, err?.status || err?.message);
      }
    }
    throw lastError || new Error('Modelos de IA temporariamente ocupados');
  }

  app.post('/api/parse-receipt', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'Nenhuma imagem fornecida.' });
      }

      const imagePart = {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64,
        },
      };

      const prompt = `Leia esta foto de Nota Fiscal / Cupom Fiscal de supermercado brasileiro na íntegra.
1. Transcreva todo o texto visível da nota fiscal no campo "rawTranscription".
2. Extraia o nome do supermercado em "establishment" e a data da compra em "purchaseDate" (formato AAAA-MM-DD).
3. Extraia TODOS os itens comprados na lista "items", contendo:
   - rawName: nome exato como está impresso na nota fiscal
   - classification: nome padronizado do produto (ex: "Coxa de Frango", "Sobrecoxa de Frango", "Filé de Frango", "Alcatra Peça", "Carré Suíno", "Arroz 1kg", "Arroz 2kg", "Arroz 5kg", "Feijão 1kg", "Macarrão Espaguete", "Leite 1L")
   - quantity: quantidade numérica comprada (ex: 1, 2, 1.45)
   - unit: unidade ("kg", "un", "L", "pct", "g")
   - unitPrice: preço unitário numérico em R$
   - totalPrice: valor total do item (quantidade x preço unitário)
   - category: setor ("Açougue", "Hortifruti", "Mercearia", "Laticínios", "Limpeza", "Bebidas", "Padaria", "Higiene")`;

      const response = await callGeminiFreeTier({
        contents: { parts: [imagePart, { text: prompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              establishment: { type: Type.STRING },
              purchaseDate: { type: Type.STRING },
              rawTranscription: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rawName: { type: Type.STRING },
                    classification: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                    unitPrice: { type: Type.NUMBER },
                    totalPrice: { type: Type.NUMBER },
                    category: { type: Type.STRING },
                  },
                  required: ['rawName', 'classification', 'quantity', 'unit', 'unitPrice', 'totalPrice', 'category'],
                },
              },
            },
            required: ['establishment', 'purchaseDate', 'rawTranscription', 'items'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({ ...parsed, source: 'gemini' });
    } catch (error: any) {
      console.warn('Fallback acionado para OCR Local no navegador:', error?.message);
      res.status(200).json({
        fallbackToLocalOCR: true,
        reason: error?.message || 'Alta demanda na nuvem',
      });
    }
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.listen(port, () => {
    console.log(`SmartPantry 2.0 rodando na porta ${port}`);
  });
}

startServer();
