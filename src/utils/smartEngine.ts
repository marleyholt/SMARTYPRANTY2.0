import Tesseract from 'tesseract.js';

export interface ReceiptItem {
  rawName: string;
  classification: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  category: string;
}

export interface ParsedReceipt {
  establishment: string;
  purchaseDate: string;
  rawTranscription: string;
  items: ReceiptItem[];
  source?: 'gemini' | 'ocr-local' | 'manual';
}

export interface PantryItemData {
  id: string;
  classification: string;
  quantity: number;
  initialQuantity: number;
  unit: string;
  category: string;
  lastUpdated: string;
  lastPurchaseDate: string;
  lastUnitPrice?: number;
  lastEstablishment?: string;
}

export interface ShoppingListItem {
  classification: string;
  quantity: number;
  unit: string;
  estimatedPrice: number;
  totalEstimated: number;
  market: string;
  aisle: string;
  reason: string;
  alternativeMarkets?: Array<{ market: string; price: number }>;
}

export interface DivergenceItem {
  id: string;
  type: 'quantity_diff' | 'missing_item' | 'unplanned_item' | 'price_diff';
  classification: string;
  plannedQty: number;
  boughtQty: number;
  unit: string;
  plannedPrice: number;
  boughtPrice: number;
  question: string;
  answer?: string;
  resolved?: boolean;
}

// Dicionário inteligente de classificações padrão para supermercados brasileiros
const CLASSIFICATION_RULES: Array<{
  keywords: RegExp;
  classification: string;
  category: string;
  defaultUnit: string;
}> = [
  { keywords: /COXA\s*(E\s*SOBRECOXA|SOBREC)/i, classification: 'Coxa e Sobrecoxa de Frango', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /SOBRECOXA\s*(DE\s*)?(FRANGO|FGO)/i, classification: 'Sobrecoxa de Frango', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /COXA\s*(DE\s*)?(FRANGO|FGO)/i, classification: 'Coxa de Frango', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /(FILE|FILÉ)\s*(DE\s*)?(PEITO|FRANGO|FGO|SASSAMI)/i, classification: 'Filé de Frango', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /PEITO\s*(DE\s*)?(FRANGO|FGO)/i, classification: 'Peito de Frango', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /ALCATRA/i, classification: 'Alcatra Peça', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /CONTRA\s*FILE|CHORIZO/i, classification: 'Contra Filé', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /PATINHO/i, classification: 'Patinho Bovino', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /ACEM|ACÉM/i, classification: 'Acém Bovino', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /CARNE\s*MOIDA/i, classification: 'Carne Moída', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /CARRE|CARRÉ|BISTECA\s*SUINA/i, classification: 'Carré Suíno', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /LINGUICA|LINGUIÇA/i, classification: 'Linguiça', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /BACON/i, classification: 'Bacon', category: 'Açougue', defaultUnit: 'kg' },
  { keywords: /ARROZ.*5\s*KG/i, classification: 'Arroz 5kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /ARROZ.*2\s*KG/i, classification: 'Arroz 2kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /ARROZ.*1\s*KG/i, classification: 'Arroz 1kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /ARROZ/i, classification: 'Arroz 1kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /FEIJAO|FEIJÃO/i, classification: 'Feijão 1kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /MACARRAO|MACARRÃO|ESPAGUETE|MASSA\s+ESP/i, classification: 'Macarrão Espaguete', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /MAC.*PARAFUSO|FUSILLI|PENNE/i, classification: 'Macarrão Parafuso/Penne', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /ACUCAR|AÇÚCAR.*5\s*KG/i, classification: 'Açúcar 5kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /ACUCAR|AÇÚCAR/i, classification: 'Açúcar 1kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /CAFE|CAFÉ/i, classification: 'Café 500g', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /OLEO|ÓLEO\s*(DE\s*)?(SOJA|GIRASSOL|CANOLA|MILHO)/i, classification: 'Óleo de Cozinha 900ml', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /AZEITE/i, classification: 'Azeite de Oliva 500ml', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /MOLHO\s*(DE\s*)?TOMATE|EXTRATO\s*TOMATE/i, classification: 'Molho de Tomate', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /FARINHA\s*(DE\s*)?TRIGO/i, classification: 'Farinha de Trigo 1kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /FARINHA\s*(DE\s*)?MANDIOCA|FAROFA/i, classification: 'Farinha de Mandioca / Farofa', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /SAL\s*(REFINADO|GROSSO|MARINHO)/i, classification: 'Sal 1kg', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /LEITE\s*CONDENSADO/i, classification: 'Leite Condensado', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /CREME\s*(DE\s*)?LEITE/i, classification: 'Creme de Leite', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /LEITE\s*(UHT|INTEGRAL|DESNATADO|SEMI|LV)/i, classification: 'Leite 1L', category: 'Laticínios', defaultUnit: 'L' },
  { keywords: /MANTEIGA/i, classification: 'Manteiga', category: 'Laticínios', defaultUnit: 'un' },
  { keywords: /MARGARINA/i, classification: 'Margarina', category: 'Laticínios', defaultUnit: 'un' },
  { keywords: /QUEIJO\s*(MUSSARELA|MUCARELA|PRATO|MINAS)/i, classification: 'Queijo Mussarela', category: 'Laticínios', defaultUnit: 'kg' },
  { keywords: /PRESUNTO/i, classification: 'Presunto', category: 'Laticínios', defaultUnit: 'kg' },
  { keywords: /REQUEIJAO|REQUEIJÃO/i, classification: 'Requeijão', category: 'Laticínios', defaultUnit: 'un' },
  { keywords: /IOGURTE/i, classification: 'Iogurte', category: 'Laticínios', defaultUnit: 'un' },
  { keywords: /OVO|OVOS/i, classification: 'Ovos Cartela', category: 'Hortifruti', defaultUnit: 'un' },
  { keywords: /BATATA/i, classification: 'Batata', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /CEBOLA/i, classification: 'Cebola', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /TOMATE/i, classification: 'Tomate', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /ALHO/i, classification: 'Alho', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /BANANA/i, classification: 'Banana', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /MACA|MAÇÃ/i, classification: 'Maçã', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /LARANJA/i, classification: 'Laranja', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /LIMAO|LIMÃO/i, classification: 'Limão', category: 'Hortifruti', defaultUnit: 'kg' },
  { keywords: /PAO\s*(DE\s*FORMA|FRANCES|INTEGRAL)/i, classification: 'Pão de Forma', category: 'Padaria', defaultUnit: 'un' },
  { keywords: /BISCOITO|BOLACHA/i, classification: 'Biscoito', category: 'Mercearia', defaultUnit: 'un' },
  { keywords: /SABAO\s*(EM\s*PO|LIQUIDO|LAVA\s*ROUPAS)/i, classification: 'Sabão Lava Roupas', category: 'Limpeza', defaultUnit: 'un' },
  { keywords: /AMACIANTE/i, classification: 'Amaciante', category: 'Limpeza', defaultUnit: 'un' },
  { keywords: /DETERGENTE/i, classification: 'Detergente 500ml', category: 'Limpeza', defaultUnit: 'un' },
  { keywords: /AGUA\s*SANITARIA|CLORO/i, classification: 'Água Sanitária', category: 'Limpeza', defaultUnit: 'un' },
  { keywords: /DESINFETANTE/i, classification: 'Desinfetante', category: 'Limpeza', defaultUnit: 'un' },
  { keywords: /PAPEL\s*HIGIENICO/i, classification: 'Papel Higiênico', category: 'Higiene', defaultUnit: 'un' },
  { keywords: /SABONETE/i, classification: 'Sabonete', category: 'Higiene', defaultUnit: 'un' },
  { keywords: /CREME\s*DENTAL|PASTA\s*DENTE/i, classification: 'Creme Dental', category: 'Higiene', defaultUnit: 'un' },
  { keywords: /SHAMPOO|XAMPU/i, classification: 'Shampoo', category: 'Higiene', defaultUnit: 'un' },
  { keywords: /REFRIGERANTE|COCA\s*COLA|GUARANA/i, classification: 'Refrigerante 2L', category: 'Bebidas', defaultUnit: 'un' },
  { keywords: /SUCO/i, classification: 'Suco 1L', category: 'Bebidas', defaultUnit: 'un' },
  { keywords: /CERVEJA/i, classification: 'Cerveja', category: 'Bebidas', defaultUnit: 'un' },
];

export function autoClassifyItem(
  rawName: string,
  existingCatalog: Array<{ rawName?: string; name?: string; classification: string; category?: string; defaultUnit?: string }> = []
): { classification: string; category: string; unit: string } {
  const cleanRaw = rawName.trim().toUpperCase();

  // 1. Verifica catálogo personalizado salvo pelo usuário no Firestore
  for (const cat of existingCatalog) {
    const matchKey = (cat.rawName || cat.name || '').trim().toUpperCase();
    if (matchKey && (cleanRaw === matchKey || cleanRaw.includes(matchKey) || matchKey.includes(cleanRaw))) {
      return {
        classification: cat.classification,
        category: cat.category || 'Mercearia',
        unit: cat.defaultUnit || 'un',
      };
    }
  }

  // 2. Verifica regras inteligentes brasileiras
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.keywords.test(cleanRaw)) {
      return {
        classification: rule.classification,
        category: rule.category,
        unit: rule.defaultUnit,
      };
    }
  }

  // 3. Normalização inteligente do próprio nome (remove códigos e números soltos)
  const formatted = cleanRaw
    .replace(/^\d+\s+/, '')
    .replace(/\b(UN|KG|PCT|LT|GR|CX)\b/gi, '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    classification: formatted || 'Item Diverso',
    category: 'Mercearia',
    unit: /\bKG\b/i.test(cleanRaw) ? 'kg' : 'un',
  };
}

/**
 * Redimensiona e melhora o contraste da foto da NF no navegador para evitar
 * payload gigante e acelerar tanto a IA quanto o OCR local Tesseract.
 */
export async function compressAndEnhanceImage(file: File): Promise<{
  base64: string;
  dataUrl: string;
  mimeType: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1600;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context indisponível'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        resolve({ base64, dataUrl, mimeType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Executa OCR 100% gratuito no navegador usando Tesseract.js (Português)
 */
export async function runLocalOCR(
  imageDataUrl: string,
  onProgress?: (progress: number, statusText: string) => void
): Promise<string> {
  const result = await Tesseract.recognize(imageDataUrl, 'por', {
    logger: (m) => {
      if (onProgress && typeof m.progress === 'number') {
        const pct = Math.round(m.progress * 100);
        const statusMap: Record<string, string> = {
          'loading tesseract core': 'Carregando motor OCR local...',
          'initializing tesseract': 'Inicializando leitor óptico...',
          'loading language traineddata': 'Carregando dicionário Português...',
          'initializing api': 'Preparando análise da Nota Fiscal...',
          'recognizing text': `Lendo linhas da Nota Fiscal (${pct}%)...`,
        };
        onProgress(pct, statusMap[m.status] || `Processando imagem (${pct}%)...`);
      }
    },
  });

  return result.data.text || '';
}

/**
 * Parser especializado em Cupons Fiscais / NFC-e / SAT Brasileiros
 */
export function parseBrazilianReceiptText(
  rawText: string,
  existingCatalog: Array<{ rawName?: string; name?: string; classification: string; category?: string; defaultUnit?: string }> = []
): ParsedReceipt {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  let establishment = 'Supermercado';
  let purchaseDate = new Date().toISOString().split('T')[0];

  // Detecta data DD/MM/AAAA
  for (const line of lines.slice(0, 15)) {
    const dateMatch = line.match(/(\d{2})[\/\-](\d{2})[\/\-](20\d{2})/);
    if (dateMatch) {
      purchaseDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      break;
    }
  }

  // Detecta nome do estabelecimento nas primeiras linhas
  const ignoreHeaderRegex = /CNPJ|CPF|IE:|IM:|EXTRATO|CUPOM\s*FISCAL|DOCUMENTO\s*AUXILIAR|NOTA\s*FISCAL|CONSUMIDOR|ENDERECO|RUA\s|AV\s|AVENIDA|CEP|FONE|TEL/i;
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 4 && !ignoreHeaderRegex.test(line) && !/^\d+[\d\.\-\/\s]+$/.test(line)) {
      establishment = line.replace(/[^a-zA-ZÀ-ÿ0-9\s\&\-]/g, '').trim();
      if (establishment.length >= 3) break;
    }
  }

  const items: ReceiptItem[] = [];
  const ignoreLineRegex = /^(SUBTOTAL|TOTAL|VALOR\s*TOTAL|VALOR\s*A\s*PAGAR|DESCONTO|ACRÉSCIMO|TROCO|DINHEIRO|CARTAO|CARTÃO|CREDITO|DEBITO|PIX|TRIBUTOS|CHAVE\s*DE\s*ACESSO|CONSULTA|CONSUMIDOR|PROTOCOLO|CNPJ|QTD\.\s*TOTAL|FORMA\s*PAGAMENTO)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ignoreLineRegex.test(line)) continue;

    // Padrão 1: Linha única com Qtd x Preço Unit = Total
    // Ex: "001 7891234 ARROZ TIO JOAO 5KG 2 UN X 24,90 49,80" ou "ALCATRA KG 1,450 KG x 39,90 57,86"
    const fullLinePattern = /^(?:\d{1,4}\s+)?(?:\d{5,14}\s+)?([A-ZÀ-Ÿa-zà-ÿ0-9\s\.\-\/]{3,}?)\s+(\d+(?:[\.,]\d{1,3})?)\s*(UN|KG|LT|L|G|PCT|CX|FD|BD)?\s*[xX\*]\s*(?:R\$\s*)?(\d+[\.,]\d{2})\s+(?:R\$\s*)?(\d+[\.,]\d{2})(?:\s*[A-Z0-9%]{1,4})?$/i;
    const matchFull = line.match(fullLinePattern);

    if (matchFull) {
      const rawName = matchFull[1].replace(/^\d+\s+/, '').trim();
      const quantity = parseFloat(matchFull[2].replace(',', '.')) || 1;
      const unitRaw = (matchFull[3] || '').toLowerCase();
      const unitPrice = parseFloat(matchFull[4].replace(',', '.')) || 0;
      const totalPrice = parseFloat(matchFull[5].replace(',', '.')) || Number((quantity * unitPrice).toFixed(2));

      if (rawName.length >= 2 && !ignoreLineRegex.test(rawName)) {
        const auto = autoClassifyItem(rawName, existingCatalog);
        items.push({
          rawName,
          classification: auto.classification,
          quantity,
          unit: unitRaw || auto.unit,
          unitPrice,
          totalPrice,
          category: auto.category,
        });
        continue;
      }
    }

    // Padrão 2: Duas linhas (Linha i = Nome do produto, Linha i+1 = "2,000 KG x 19,90 39,80")
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const qtyPricePattern = /^(\d+(?:[\.,]\d{1,3})?)\s*(UN|KG|LT|L|G|PCT|CX)?\s*[xX\*]\s*(?:R\$\s*)?(\d+[\.,]\d{2})\s+(?:=?\s*)?(?:R\$\s*)?(\d+[\.,]\d{2})/i;
      const matchNext = nextLine.match(qtyPricePattern);

      if (matchNext && !/^\d+[\.,]\d{2}$/.test(line)) {
        const rawName = line
          .replace(/^\d{1,4}\s+/, '')
          .replace(/^\d{5,14}\s+/, '')
          .trim();

        if (rawName.length >= 2 && !ignoreLineRegex.test(rawName)) {
          const quantity = parseFloat(matchNext[1].replace(',', '.')) || 1;
          const unitRaw = (matchNext[2] || '').toLowerCase();
          const unitPrice = parseFloat(matchNext[3].replace(',', '.')) || 0;
          const totalPrice = parseFloat(matchNext[4].replace(',', '.')) || Number((quantity * unitPrice).toFixed(2));
          const auto = autoClassifyItem(rawName, existingCatalog);

          items.push({
            rawName,
            classification: auto.classification,
            quantity,
            unit: unitRaw || auto.unit,
            unitPrice,
            totalPrice,
            category: auto.category,
          });
          i++; // Pula a linha de preço já consumida
          continue;
        }
      }
    }

    // Padrão 3: Linha simples "PRODUTO NOME ... 15,99"
    const simplePattern = /^(?:\d{1,4}\s+)?(?:\d{5,14}\s+)?([A-ZÀ-Ÿa-zà-ÿ][A-ZÀ-Ÿa-zà-ÿ0-9\s\.\-]{2,}?)\s+(?:R\$\s*)?(\d+[\.,]\d{2})(?:\s*[A-Z]{1,2})?$/;
    const matchSimple = line.match(simplePattern);
    if (matchSimple) {
      const rawName = matchSimple[1].trim();
      const price = parseFloat(matchSimple[2].replace(',', '.')) || 0;

      if (rawName.length >= 3 && price > 0 && price < 2000 && !ignoreLineRegex.test(rawName)) {
        const auto = autoClassifyItem(rawName, existingCatalog);
        items.push({
          rawName,
          classification: auto.classification,
          quantity: 1,
          unit: auto.unit,
          unitPrice: price,
          totalPrice: price,
          category: auto.category,
        });
      }
    }
  }

  return {
    establishment,
    purchaseDate,
    rawTranscription: rawText,
    items,
    source: 'ocr-local',
  };
}

/**
 * Converte lista de itens para string CSV conforme especificado no plano
 * Colunas: NOME REAL, CLASSIFICAÇÃO, QUANTIDADE COMPRADA, PREÇO UNITÁRIO, MULTIPLICAÇÃO (QTD X PREÇO), ESTABELECIMENTO COMPRADO, DATA DA COMPRA
 */
export function generateCSVFromReceipt(
  establishment: string,
  purchaseDate: string,
  items: ReceiptItem[]
): string {
  const header =
    'NOME REAL;CLASSIFICAÇÃO;QUANTIDADE COMPRADA;UNIDADE;PREÇO UNITÁRIO;MULTIPLICAÇÃO QTD X PREÇO;ESTABELECIMENTO COMPRADO;DATA DA COMPRA';
  const rows = items.map((it) => {
    const mult = Number((it.quantity * it.unitPrice).toFixed(2));
    return [
      `"${(it.rawName || '').replace(/"/g, '""')}"`,
      `"${(it.classification || '').replace(/"/g, '""')}"`,
      it.quantity,
      it.unit || 'un',
      it.unitPrice.toFixed(2),
      mult.toFixed(2),
      `"${(establishment || '').replace(/"/g, '""')}"`,
      purchaseDate,
    ].join(';');
  });
  return [header, ...rows].join('\n');
}

/**
 * Motor Determinístico de Recomendação de Lista de Compras (100% Gratuito, Instantâneo, Sem erro 503)
 */
export function buildSmartShoppingListLocally(params: {
  pantryItems: PantryItemData[];
  receiptsHistory: any[];
  intervalDays: number;
  strategy: 'single' | 'multiple';
  selectedSingleMarket?: string;
  learningAdjustments?: Record<string, { preferredQty?: number; ignored?: boolean; preferredMarket?: string }>;
}): {
  estimatedCost: number;
  suggestions: string;
  availableMarkets: string[];
  recommendedMarket: string;
  items: ShoppingListItem[];
} {
  const {
    pantryItems,
    receiptsHistory,
    intervalDays,
    strategy,
    selectedSingleMarket,
    learningAdjustments = {},
  } = params;

  // 1. Mapeia histórico de preços por item classificado e por estabelecimento
  const priceMap: Record<string, Record<string, { price: number; date: string; unit: string; category: string }>> = {};
  const allMarketsSet = new Set<string>();

  for (const purchase of receiptsHistory) {
    const marketName = (purchase.establishment || 'Supermercado Principal').trim();
    allMarketsSet.add(marketName);
    const pItems: ReceiptItem[] = Array.isArray(purchase.items) ? purchase.items : [];

    for (const it of pItems) {
      const key = (it.classification || it.rawName || '').trim();
      if (!key) continue;
      if (!priceMap[key]) priceMap[key] = {};

      const unitPrice = Number(it.unitPrice) || 0;
      if (unitPrice > 0) {
        const existing = priceMap[key][marketName];
        if (!existing || new Date(purchase.purchaseDate) >= new Date(existing.date)) {
          priceMap[key][marketName] = {
            price: unitPrice,
            date: purchase.purchaseDate || new Date().toISOString(),
            unit: it.unit || 'un',
            category: it.category || 'Mercearia',
          };
        }
      }
    }
  }

  const availableMarkets = Array.from(allMarketsSet);
  if (availableMarkets.length === 0) {
    availableMarkets.push('Supermercado Principal');
  }

  // Fator proporcional ao período escolhido (base = 15 dias)
  const periodFactor = Math.max(0.5, intervalDays / 15);

  // 2. Identifica itens que precisam de reposição na Dispensa
  const neededItems: Array<{
    classification: string;
    quantity: number;
    unit: string;
    aisle: string;
    reason: string;
    fallbackPrice: number;
  }> = [];

  for (const pItem of pantryItems) {
    const key = pItem.classification;
    const learned = learningAdjustments[key];
    if (learned?.ignored) continue;

    const currentQty = Number(pItem.quantity) || 0;
    const baseInitial = Number(pItem.initialQuantity) || Math.max(1, currentQty);

    // Repor se estiver zerado ou abaixo de 35% da quantidade inicial
    if (currentQty <= 0 || currentQty < baseInitial * 0.35) {
      let targetQty = learned?.preferredQty
        ? learned.preferredQty
        : Math.max(1, Math.ceil((baseInitial - currentQty) * periodFactor));

      const daysSince = pItem.lastPurchaseDate
        ? Math.max(1, Math.floor((Date.now() - new Date(pItem.lastPurchaseDate).getTime()) / (1000 * 60 * 60 * 24)))
        : 15;

      const reason =
        currentQty <= 0
          ? `Estoque zerado (0 / ${baseInitial} ${pItem.unit || 'un'}). Última compra há ${daysSince} dia(s).`
          : `Estoque baixo (${currentQty} / ${baseInitial} ${pItem.unit || 'un'}). Reposição para ${intervalDays} dias.`;

      neededItems.push({
        classification: key,
        quantity: targetQty,
        unit: pItem.unit || 'un',
        aisle: pItem.category || autoClassifyItem(key).category,
        reason,
        fallbackPrice: Number(pItem.lastUnitPrice) || 12.9,
      });
    }
  }

  // 3. Calcula melhor mercado (se estratégia 'single')
  let bestSingleMarket = selectedSingleMarket || availableMarkets[0];
  if (strategy === 'single' && !selectedSingleMarket && availableMarkets.length > 1) {
    let lowestTotal = Infinity;
    for (const mkt of availableMarkets) {
      let sum = 0;
      for (const item of neededItems) {
        const mktPrice = priceMap[item.classification]?.[mkt]?.price ?? item.fallbackPrice;
        sum += mktPrice * item.quantity;
      }
      if (sum < lowestTotal) {
        lowestTotal = sum;
        bestSingleMarket = mkt;
      }
    }
  }

  // 4. Monta a lista final com otimização de preços
  const finalItems: ShoppingListItem[] = [];
  let totalCost = 0;
  let savingsFromMultiMarket = 0;

  for (const item of neededItems) {
    const marketPricesObj = priceMap[item.classification] || {};
    const marketEntries = Object.entries(marketPricesObj).map(([market, info]) => ({
      market,
      price: info.price,
    }));

    marketEntries.sort((a, b) => a.price - b.price);

    let chosenMarket = bestSingleMarket;
    let chosenPrice = item.fallbackPrice;

    if (strategy === 'multiple' && marketEntries.length > 0) {
      chosenMarket = marketEntries[0].market;
      chosenPrice = marketEntries[0].price;
      const highestPrice = marketEntries[marketEntries.length - 1].price;
      savingsFromMultiMarket += (highestPrice - chosenPrice) * item.quantity;
    } else if (strategy === 'single') {
      chosenMarket = bestSingleMarket;
      chosenPrice =
        marketPricesObj[bestSingleMarket]?.price ??
        (marketEntries[0]?.price ?? item.fallbackPrice);
    }

    const totalEstimated = Number((chosenPrice * item.quantity).toFixed(2));
    totalCost += totalEstimated;

    finalItems.push({
      classification: item.classification,
      quantity: item.quantity,
      unit: item.unit,
      estimatedPrice: chosenPrice,
      totalEstimated,
      market: chosenMarket,
      aisle: item.aisle,
      reason: item.reason,
      alternativeMarkets: marketEntries,
    });
  }

  const suggestions =
    strategy === 'multiple'
      ? `Lista otimizada para ${intervalDays} dias dividindo a compra entre os mercados mais baratos do seu histórico. Economia estimada de R$ ${savingsFromMultiMarket.toFixed(2)} em relação aos preços mais altos registrados.`
      : `Lista concentrada no estabelecimento "${bestSingleMarket}" para o período de ${intervalDays} dias, priorizando praticidade e o menor custo global de cesta.`;

  return {
    estimatedCost: Number(totalCost.toFixed(2)),
    suggestions,
    availableMarkets,
    recommendedMarket: bestSingleMarket,
    items: finalItems,
  };
}

/**
 * Motor de Comparativo Pós-Compra (compara a Lista de Compras planejada vs a NF importada)
 */
export function comparePurchaseLocally(
  shoppingListItems: ShoppingListItem[],
  purchasedItems: ReceiptItem[]
): {
  divergenceSummary: string;
  divergences: DivergenceItem[];
} {
  const divergences: DivergenceItem[] = [];
  const boughtMap = new Map<string, ReceiptItem>();

  for (const p of purchasedItems) {
    const key = (p.classification || p.rawName).trim().toLowerCase();
    const existing = boughtMap.get(key);
    if (existing) {
      existing.quantity += Number(p.quantity) || 0;
      existing.totalPrice += Number(p.totalPrice) || 0;
    } else {
      boughtMap.set(key, { ...p });
    }
  }

  let matchedCount = 0;

  for (const planned of shoppingListItems) {
    const key = planned.classification.trim().toLowerCase();
    const bought = boughtMap.get(key);

    if (!bought) {
      divergences.push({
        id: `missing-${key}`,
        type: 'missing_item',
        classification: planned.classification,
        plannedQty: planned.quantity,
        boughtQty: 0,
        unit: planned.unit,
        plannedPrice: planned.estimatedPrice,
        boughtPrice: 0,
        question: `Você planejou comprar ${planned.quantity} ${planned.unit} de "${planned.classification}", mas ele não consta na Nota Fiscal. O produto estava em falta, caro ou você desistiu da compra?`,
      });
    } else {
      matchedCount++;
      boughtMap.delete(key);

      if (Math.abs(bought.quantity - planned.quantity) >= 0.1) {
        divergences.push({
          id: `qty-${key}`,
          type: 'quantity_diff',
          classification: planned.classification,
          plannedQty: planned.quantity,
          boughtQty: bought.quantity,
          unit: planned.unit,
          plannedPrice: planned.estimatedPrice,
          boughtPrice: bought.unitPrice,
          question: `Por que você comprou ${bought.quantity} ${bought.unit} de "${planned.classification}" ao invés de ${planned.quantity} ${planned.unit} como estava na lista? Devemos ajustar a quantidade padrão das próximas listas para ${bought.quantity} ${bought.unit}?`,
        });
      }
    }
  }

  // Itens comprados fora da lista
  for (const [key, extra] of boughtMap.entries()) {
    divergences.push({
      id: `extra-${key}`,
      type: 'unplanned_item',
      classification: extra.classification || extra.rawName,
      plannedQty: 0,
      boughtQty: extra.quantity,
      unit: extra.unit || 'un',
      plannedPrice: 0,
      boughtPrice: extra.unitPrice,
      question: `O item "${extra.classification || extra.rawName}" (${extra.quantity} ${extra.unit}) foi comprado na NF mas não estava na lista planejada. Deseja incluir este item nas recomendações recorrentes?`,
    });
  }

  const totalPlanned = shoppingListItems.length || 1;
  const adherencePct = Math.round((matchedCount / totalPlanned) * 100);

  const divergenceSummary = `Sua compra teve ${adherencePct}% de fidelidade aos itens da lista planejada (${matchedCount} de ${shoppingListItems.length} itens encontrados na NF). Foram identificadas ${divergences.length} divergência(s) para calibrar o aprendizado do sistema.`;

  return {
    divergenceSummary,
    divergences,
  };
}
