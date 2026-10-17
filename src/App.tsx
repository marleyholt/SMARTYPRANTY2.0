import React, { useState, useEffect, useMemo } from 'react';
import {
  Receipt,
  Package,
  ShoppingCart,
  BarChart3,
  Upload,
  CheckCircle,
  Trash2,
  Plus,
  Sparkles,
  AlertTriangle,
  LogOut,
  User as UserIcon,
  Layers,
  ArrowRight,
  Check,
  FileText,
  Download,
  Camera,
  RefreshCw,
  Store,
  Calendar,
  Brain,
  SlidersHorizontal,
  Minus,
  RotateCcw,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  ReceiptItem,
  ParsedReceipt,
  PantryItemData,
  ShoppingListItem,
  DivergenceItem,
  autoClassifyItem,
  compressAndEnhanceImage,
  runLocalOCR,
  parseBrazilianReceiptText,
  generateCSVFromReceipt,
  buildSmartShoppingListLocally,
  comparePurchaseLocally,
} from './utils/smartEngine';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

const STANDARD_CLASSIFICATION_SUGGESTIONS = [
  'Coxa de Frango',
  'Sobrecoxa de Frango',
  'Filé de Frango',
  'Alcatra Peça',
  'Contra Filé',
  'Carré Suíno',
  'Carne Moída',
  'Arroz 1kg',
  'Arroz 2kg',
  'Arroz 5kg',
  'Feijão 1kg',
  'Macarrão Espaguete',
  'Leite 1L',
  'Café 500g',
  'Óleo de Cozinha 900ml',
  'Açúcar 1kg',
  'Ovos Cartela',
  'Queijo Mussarela',
  'Manteiga',
  'Detergente 500ml',
  'Sabão Lava Roupas',
];

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeTab, setActiveTab] = useState<
    'receipts' | 'classification' | 'pantry' | 'shopping' | 'comparison'
  >('receipts');
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Estado Etapa 1: Leitura de NF (Foto + OCR Local / Híbrido + Transcrição + CSV Preview)
  const [selectedImageBase64, setSelectedImageBase64] = useState<string | null>(null);
  const [selectedImageDataUrl, setSelectedImageDataUrl] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [isProcessingPhoto, setIsProcessingPhoto] = useState<boolean>(false);
  const [ocrStatusText, setOcrStatusText] = useState<string>('');
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [rawTranscription, setRawTranscription] = useState<string>('');
  const [showCsvModal, setShowCsvModal] = useState<boolean>(false);
  const [previewReceipt, setPreviewReceipt] = useState<ParsedReceipt | null>(null);

  // Dados sincronizados do Firestore
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [receiptsHistory, setReceiptsHistory] = useState<any[]>([]);
  const [pantryItems, setPantryItems] = useState<PantryItemData[]>([]);
  const [savedShoppingLists, setSavedShoppingLists] = useState<any[]>([]);

  // Estado Etapa 2: Fila de Classificação
  const [pendingClassification, setPendingClassification] = useState<
    Array<ReceiptItem & { establishment: string; purchaseDate: string }>
  >([]);

  // Estado Etapa 4: Configuração e Lista de Compras Inteligente
  const [intervalDays, setIntervalDays] = useState<number>(15);
  const [strategy, setStrategy] = useState<'single' | 'multiple'>('multiple');
  const [selectedSingleMarket, setSelectedSingleMarket] = useState<string>('');
  const [groupByMode, setGroupByMode] = useState<'aisle' | 'market'>('market');
  const [currentShoppingList, setCurrentShoppingList] = useState<{
    id?: string;
    estimatedCost: number;
    suggestions: string;
    availableMarkets: string[];
    recommendedMarket: string;
    intervalDays: number;
    strategy: 'single' | 'multiple';
    items: ShoppingListItem[];
  } | null>(null);
  const [learningAdjustments, setLearningAdjustments] = useState<
    Record<string, { preferredQty?: number; ignored?: boolean }>
  >({});
  const [pendingLearningPrompt, setPendingLearningPrompt] = useState<{
    classification: string;
    actionDescription: string;
    newQty?: number;
    ignored?: boolean;
  } | null>(null);
  const [newManualListItem, setNewManualListItem] = useState({
    classification: '',
    quantity: 1,
    unit: 'un',
    estimatedPrice: 10,
    market: 'Supermercado Principal',
    aisle: 'Mercearia',
  });

  // Estado Etapa 5: Comparativo Pós-Compra
  const [comparisonResult, setComparisonResult] = useState<{
    divergenceSummary: string;
    divergences: DivergenceItem[];
    purchaseEstablishment?: string;
    purchaseDate?: string;
  } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // Monitora autenticação
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Sincroniza coleções do Firestore
  useEffect(() => {
    if (!user) {
      setPantryItems([]);
      setReceiptsHistory([]);
      setCatalogItems([]);
      setSavedShoppingLists([]);
      return;
    }

    const userId = user.uid;

    const unsubCatalog = onSnapshot(
      collection(db, 'users', userId, 'items'),
      (snap) => {
        setCatalogItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${userId}/items`)
    );

    const unsubPantry = onSnapshot(
      collection(db, 'users', userId, 'pantry'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PantryItemData[];
        list.sort((a, b) => a.classification.localeCompare(b.classification));
        setPantryItems(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${userId}/pantry`)
    );

    const unsubPurchases = onSnapshot(
      collection(db, 'users', userId, 'purchases'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setReceiptsHistory(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${userId}/purchases`)
    );

    const unsubLists = onSnapshot(
      collection(db, 'users', userId, 'shopping_lists'),
      (snap) => {
        const lists = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        lists.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setSavedShoppingLists(lists);
        if (lists.length > 0 && !currentShoppingList) {
          const latest = lists[0];
          try {
            const parsedItems =
              typeof latest.itemsJson === 'string'
                ? JSON.parse(latest.itemsJson)
                : latest.items || [];
            setCurrentShoppingList({
              id: latest.id,
              estimatedCost: latest.estimatedCost || 0,
              suggestions:
                latest.suggestions ||
                'Lista recuperada do histórico. Você pode ajustar itens ou gerar uma nova.',
              availableMarkets: latest.availableMarkets || ['Supermercado Principal'],
              recommendedMarket: latest.recommendedMarket || 'Supermercado Principal',
              intervalDays: latest.intervalDays || 15,
              strategy: latest.strategy || 'multiple',
              items: parsedItems,
            });
          } catch {
            // ignore parse error
          }
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${userId}/shopping_lists`)
    );

    return () => {
      unsubCatalog();
      unsubPantry();
      unsubPurchases();
      unsubLists();
    };
  }, [user]);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithRedirect(auth, provider);
      } catch (redirectError) {
        console.error('Erro no login:', redirectError);
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  // ETAPA 1: Upload da Foto da NF e Leitura Híbrida (Gemini Gratuito + OCR Local Tesseract.js)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingPhoto(true);
      setOcrProgress(10);
      setOcrStatusText('Otimizando resolução e contraste da foto da Nota Fiscal...');

      const compressed = await compressAndEnhanceImage(file);
      setSelectedImageBase64(compressed.base64);
      setSelectedImageDataUrl(compressed.dataUrl);
      setImageMime(compressed.mimeType);

      // Tenta primeiro a transcrição + extração via API e cai automaticamente para o OCR Local Tesseract.js se houver 503
      await executeFullReceiptReading(compressed.base64, compressed.dataUrl, compressed.mimeType);
    } catch (err) {
      console.error('Erro ao carregar foto:', err);
      showToast('Não foi possível processar a imagem selecionada.');
    } finally {
      setIsProcessingPhoto(false);
    }
  };

  const executeFullReceiptReading = async (
    base64: string,
    dataUrl: string,
    mime: string,
    forceLocalOcr = false
  ) => {
    setIsProcessingPhoto(true);
    setOcrProgress(15);

    if (!forceLocalOcr) {
      try {
        setOcrStatusText('Analisando foto da Nota Fiscal...');
        const res = await fetch('/api/parse-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mimeType: mime }),
        });
        const data = await res.json();

        if (res.ok && !data.fallbackToLocalOCR && Array.isArray(data.items) && data.items.length > 0) {
          // Aplica também o catálogo do usuário para garantir classificações já conhecidas
          const enrichedItems: ReceiptItem[] = data.items.map((it: any) => {
            const auto = autoClassifyItem(it.rawName || '', catalogItems);
            return {
              rawName: it.rawName || 'ITEM NF',
              classification: it.classification || auto.classification,
              quantity: Number(it.quantity) || 1,
              unit: it.unit || auto.unit,
              unitPrice: Number(it.unitPrice) || 0,
              totalPrice:
                Number(it.totalPrice) ||
                Number(((Number(it.quantity) || 1) * (Number(it.unitPrice) || 0)).toFixed(2)),
              category: it.category || auto.category,
            };
          });

          setRawTranscription(data.rawTranscription || '');
          setPreviewReceipt({
            establishment: data.establishment || 'Supermercado',
            purchaseDate: data.purchaseDate || new Date().toISOString().split('T')[0],
            rawTranscription: data.rawTranscription || '',
            items: enrichedItems,
            source: 'gemini',
          });
          setIsProcessingPhoto(false);
          showToast(
            `Nota Fiscal lida com sucesso! ${enrichedItems.length} itens identificados para conferência.`
          );
          return;
        }
      } catch {
        // Segue automaticamente para o OCR Local gratuito
      }
    }

    // OCR Óptico Local 100% Gratuito via Tesseract.js (Sem limite e sem erro 503)
    try {
      setOcrStatusText('Executando Leitor Óptico Local (OCR em Português)...');
      const fullText = await runLocalOCR(dataUrl, (pct, status) => {
        setOcrProgress(pct);
        setOcrStatusText(status);
      });

      setRawTranscription(fullText);
      const parsed = parseBrazilianReceiptText(fullText, catalogItems);

      if (parsed.items.length === 0) {
        // Caso a foto esteja muito desfocada, cria linhas a partir das linhas não vazias da transcrição para o usuário conferir
        const fallbackLines = fullText
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 3)
          .slice(0, 12);

        parsed.items =
          fallbackLines.length > 0
            ? fallbackLines.map((line) => {
                const auto = autoClassifyItem(line, catalogItems);
                return {
                  rawName: line,
                  classification: auto.classification,
                  quantity: 1,
                  unit: auto.unit,
                  unitPrice: 0,
                  totalPrice: 0,
                  category: auto.category,
                };
              })
            : [
                {
                  rawName: 'NOVO ITEM DA NOTA',
                  classification: 'Arroz 5kg',
                  quantity: 1,
                  unit: 'un',
                  unitPrice: 0,
                  totalPrice: 0,
                  category: 'Mercearia',
                },
              ];
      }

      setPreviewReceipt(parsed);
      showToast(
        `Transcrição concluída via OCR Local! Confira os ${parsed.items.length} itens na tabela abaixo.`
      );
    } catch (ocrErr) {
      console.error('Erro no OCR local:', ocrErr);
      showToast('Erro ao transcrever imagem. Você pode colar o texto ou preencher a tabela.');
    } finally {
      setIsProcessingPhoto(false);
      setOcrStatusText('');
    }
  };

  // Reprocessa a transcrição editada na íntegra
  const handleReparseFromTranscription = () => {
    if (!rawTranscription.trim()) {
      showToast('Digite ou cole o texto da Nota Fiscal na caixa de transcrição.');
      return;
    }
    const parsed = parseBrazilianReceiptText(rawTranscription, catalogItems);
    setPreviewReceipt(parsed);
    showToast(`Transcrição processada: ${parsed.items.length} linha(s) de itens extraídas.`);
  };

  // Exportar arquivo dados.csv
  const handleDownloadCsv = () => {
    if (!previewReceipt) return;
    const csvContent = generateCSVFromReceipt(
      previewReceipt.establishment,
      previewReceipt.purchaseDate,
      previewReceipt.items
    );
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dados_nf_${previewReceipt.purchaseDate || 'compra'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Importa os dados conferidos na memória para o Firestore e envia para a aba CLASSIFICAÇÃO
  const importReceiptToDatabase = async () => {
    if (!previewReceipt || !user) return;
    const validItems = previewReceipt.items.filter((it) => it.rawName.trim() !== '');
    if (validItems.length === 0) {
      showToast('Adicione pelo menos 1 item válido antes de importar.');
      return;
    }

    const normalizedItems = validItems.map((it) => ({
      ...it,
      totalPrice: Number((it.quantity * it.unitPrice).toFixed(2)),
    }));

    const csvData = generateCSVFromReceipt(
      previewReceipt.establishment,
      previewReceipt.purchaseDate,
      normalizedItems
    );

    try {
      const purchaseRef = collection(db, 'users', user.uid, 'purchases');
      await addDoc(purchaseRef, {
        userId: user.uid,
        establishment: previewReceipt.establishment,
        purchaseDate: previewReceipt.purchaseDate,
        csvData,
        rawTranscription: rawTranscription || previewReceipt.rawTranscription || '',
        items: normalizedItems,
        createdAt: new Date().toISOString(),
      });

      // Envia para a fila de CLASSIFICAÇÃO
      const itemsWithMeta = normalizedItems.map((it) => ({
        ...it,
        establishment: previewReceipt.establishment,
        purchaseDate: previewReceipt.purchaseDate,
      }));
      setPendingClassification((prev) => [...prev, ...itemsWithMeta]);

      // Se já existia uma Lista de Compras gerada, calcula automaticamente o Comparativo Pós-Compra (Etapa 5)
      if (currentShoppingList && currentShoppingList.items.length > 0) {
        const comp = comparePurchaseLocally(currentShoppingList.items, normalizedItems);
        setComparisonResult({
          ...comp,
          purchaseEstablishment: previewReceipt.establishment,
          purchaseDate: previewReceipt.purchaseDate,
        });
      }

      showToast(
        `NF importada (${normalizedItems.length} itens)! Confira agora a Classificação antes de enviar à Dispensa.`
      );
      setPreviewReceipt(null);
      setSelectedImageBase64(null);
      setSelectedImageDataUrl(null);
      setRawTranscription('');
      setActiveTab('classification');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/purchases`);
    }
  };

  // ETAPA 2: Validar Classificação e Enviar para a Dispensa
  const sendItemToPantry = async (
    item: ReceiptItem & { establishment?: string; purchaseDate?: string },
    indexInQueue: number
  ) => {
    if (!user) return;
    try {
      const cleanClassification = (item.classification || item.rawName).trim();

      // 1. Salva no catálogo `items` para aprendizado automático futuro
      const existingCat = catalogItems.find(
        (c) => (c.name || '').toUpperCase() === item.rawName.trim().toUpperCase()
      );
      if (!existingCat) {
        await addDoc(collection(db, 'users', user.uid, 'items'), {
          userId: user.uid,
          name: item.rawName.trim(),
          classification: cleanClassification,
          category: item.category || 'Mercearia',
          defaultUnit: item.unit || 'un',
        });
      }

      // 2. Verifica se já existe esse item classificado na Dispensa para somar/atualizar
      const existingPantry = pantryItems.find(
        (p) => p.classification.toLowerCase() === cleanClassification.toLowerCase()
      );

      if (existingPantry) {
        const newQty = Number((Number(existingPantry.quantity || 0) + Number(item.quantity || 1)).toFixed(2));
        const newInit = Math.max(newQty, Number(existingPantry.initialQuantity || 0));
        await updateDoc(doc(db, 'users', user.uid, 'pantry', existingPantry.id), {
          quantity: newQty,
          initialQuantity: newInit,
          unit: item.unit || existingPantry.unit || 'un',
          category: item.category || existingPantry.category || 'Mercearia',
          lastUpdated: new Date().toISOString(),
          lastPurchaseDate: item.purchaseDate || new Date().toISOString().split('T')[0],
          lastUnitPrice: item.unitPrice || existingPantry.lastUnitPrice || 0,
          lastEstablishment: item.establishment || existingPantry.lastEstablishment || 'Supermercado',
        });
      } else {
        await addDoc(collection(db, 'users', user.uid, 'pantry'), {
          userId: user.uid,
          classification: cleanClassification,
          quantity: Number(item.quantity) || 1,
          initialQuantity: Number(item.quantity) || 1,
          unit: item.unit || 'un',
          category: item.category || 'Mercearia',
          lastUpdated: new Date().toISOString(),
          lastPurchaseDate: item.purchaseDate || new Date().toISOString().split('T')[0],
          lastUnitPrice: Number(item.unitPrice) || 0,
          lastEstablishment: item.establishment || 'Supermercado',
        });
      }

      setPendingClassification((prev) => prev.filter((_, i) => i !== indexInQueue));
      showToast(`"${cleanClassification}" validado e enviado para a Dispensa!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/pantry`);
    }
  };

  const sendAllClassifiedToPantry = async () => {
    if (!user || pendingClassification.length === 0) return;
    const queueCopy = [...pendingClassification];
    setPendingClassification([]);
    for (let i = 0; i < queueCopy.length; i++) {
      await sendItemToPantry(queueCopy[i], -1);
    }
    showToast(`Todos os ${queueCopy.length} itens foram enviados para a Dispensa!`);
    setActiveTab('pantry');
  };

  // ETAPA 3: Controle de Dispensa (Reduzir/Zerar mantendo item com opacidade)
  const updatePantryStock = async (item: PantryItemData, newQty: number) => {
    if (!user) return;
    const clamped = Math.max(0, Number(newQty.toFixed(2)));
    try {
      await updateDoc(doc(db, 'users', user.uid, 'pantry', item.id), {
        quantity: clamped,
        lastUpdated: new Date().toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/pantry/${item.id}`);
    }
  };

  // ETAPA 4: Gerar Lista de Compras Inteligente (100% Gratuito, Determinístico e Instantâneo)
  const handleGenerateSmartList = async () => {
    if (!user) return;

    const generated = buildSmartShoppingListLocally({
      pantryItems,
      receiptsHistory,
      intervalDays,
      strategy,
      selectedSingleMarket: selectedSingleMarket || undefined,
      learningAdjustments,
    });

    const newListState = {
      ...generated,
      intervalDays,
      strategy,
    };

    setCurrentShoppingList(newListState);

    try {
      const docRef = await addDoc(collection(db, 'users', user.uid, 'shopping_lists'), {
        userId: user.uid,
        intervalDays,
        strategy,
        itemsJson: JSON.stringify(generated.items),
        estimatedCost: generated.estimatedCost,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      setCurrentShoppingList((prev) => (prev ? { ...prev, id: docRef.id } : null));
      showToast(`Lista de Compras gerada para ${intervalDays} dias com previsão de custo!`);
      setActiveTab('shopping');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/shopping_lists`);
    }
  };

  // Alterar quantidade ou remover item da Lista de Compras -> Aciona Confirmação de Aprendizado
  const handleUpdateShoppingItemQty = (classification: string, newQty: number) => {
    if (!currentShoppingList) return;
    if (newQty <= 0) {
      handleRemoveShoppingItem(classification);
      return;
    }

    const updatedItems = currentShoppingList.items.map((it) => {
      if (it.classification === classification) {
        const totalEstimated = Number((newQty * it.estimatedPrice).toFixed(2));
        return { ...it, quantity: newQty, totalEstimated };
      }
      return it;
    });

    const newCost = Number(
      updatedItems.reduce((acc, it) => acc + it.totalEstimated, 0).toFixed(2)
    );

    setCurrentShoppingList({
      ...currentShoppingList,
      items: updatedItems,
      estimatedCost: newCost,
    });

    setPendingLearningPrompt({
      classification,
      actionDescription: `Você alterou a quantidade de "${classification}" para ${newQty}. Deseja que o sistema aprenda essa quantidade padrão para as próximas listas?`,
      newQty,
    });
  };

  const handleRemoveShoppingItem = (classification: string) => {
    if (!currentShoppingList) return;
    const updatedItems = currentShoppingList.items.filter(
      (it) => it.classification !== classification
    );
    const newCost = Number(
      updatedItems.reduce((acc, it) => acc + it.totalEstimated, 0).toFixed(2)
    );

    setCurrentShoppingList({
      ...currentShoppingList,
      items: updatedItems,
      estimatedCost: newCost,
    });

    setPendingLearningPrompt({
      classification,
      actionDescription: `Você removeu "${classification}" da lista de compras. Deseja que o sistema aprenda a não sugerir este item automaticamente?`,
      ignored: true,
    });
  };

  const confirmLearningRule = (confirm: boolean) => {
    if (confirm && pendingLearningPrompt) {
      setLearningAdjustments((prev) => ({
        ...prev,
        [pendingLearningPrompt.classification]: {
          preferredQty: pendingLearningPrompt.newQty,
          ignored: pendingLearningPrompt.ignored,
        },
      }));
      showToast(
        `Aprendizado confirmado para "${pendingLearningPrompt.classification}"! As próximas listas seguirão este padrão.`
      );
    }
    setPendingLearningPrompt(null);
  };

  const handleAddManualItemToShoppingList = () => {
    if (!currentShoppingList || !newManualListItem.classification.trim()) return;
    const totalEstimated = Number(
      (newManualListItem.quantity * newManualListItem.estimatedPrice).toFixed(2)
    );
    const newItem: ShoppingListItem = {
      classification: newManualListItem.classification.trim(),
      quantity: newManualListItem.quantity,
      unit: newManualListItem.unit,
      estimatedPrice: newManualListItem.estimatedPrice,
      totalEstimated,
      market: newManualListItem.market,
      aisle: newManualListItem.aisle,
      reason: 'Adicionado manualmente pelo usuário',
    };

    const updatedItems = [...currentShoppingList.items, newItem];
    const newCost = Number(
      updatedItems.reduce((acc, it) => acc + it.totalEstimated, 0).toFixed(2)
    );

    setCurrentShoppingList({
      ...currentShoppingList,
      items: updatedItems,
      estimatedCost: newCost,
    });

    setPendingLearningPrompt({
      classification: newItem.classification,
      actionDescription: `Você adicionou "${newItem.classification}" (${newItem.quantity} ${newItem.unit}). Deseja memorizar essa preferência nas próximas listas?`,
      newQty: newItem.quantity,
    });

    setNewManualListItem({
      classification: '',
      quantity: 1,
      unit: 'un',
      estimatedPrice: 10,
      market: currentShoppingList.recommendedMarket || 'Supermercado Principal',
      aisle: 'Mercearia',
    });
  };

  // ETAPA 5: Executar Comparativo Pós-Compra manualmente
  const handleRunComparison = () => {
    if (!currentShoppingList || currentShoppingList.items.length === 0) {
      showToast('Gere uma Lista de Compras primeiro para poder comparar.');
      return;
    }
    if (receiptsHistory.length === 0) {
      showToast('Importe pelo menos uma Nota Fiscal para comparar com a Lista.');
      return;
    }
    const latestPurchase = receiptsHistory[0];
    const comp = comparePurchaseLocally(currentShoppingList.items, latestPurchase.items || []);
    setComparisonResult({
      ...comp,
      purchaseEstablishment: latestPurchase.establishment,
      purchaseDate: latestPurchase.purchaseDate,
    });
    setActiveTab('comparison');
  };

  // Mercados conhecidos a partir do histórico de NFs
  const knownMarkets = useMemo(() => {
    const s = new Set<string>();
    receiptsHistory.forEach((r) => {
      if (r.establishment) s.add(r.establishment);
    });
    return Array.from(s);
  }, [receiptsHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 font-medium">Carregando SmartPantry 2.0...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-slate-800 border border-slate-700 p-8 rounded-2xl shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
            <ShoppingCart className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">SmartPantry 2.0</h1>
            <p className="text-slate-400 text-sm">
              Leitura de Notas Fiscais (OCR + IA), Classificação Inteligente, Gestão de Dispensa e Otimização de Preços.
            </p>
          </div>
          <button
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 font-semibold py-3 px-4 rounded-xl hover:bg-slate-100 transition-colors shadow-lg cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Entrar com Google
          </button>
        </div>
      </div>
    );
  }

  const totalPreviewValue =
    previewReceipt?.items.reduce((acc, it) => acc + it.quantity * it.unitPrice, 0) || 0;
  const totalPreviewUnits =
    previewReceipt?.items.reduce((acc, it) => acc + Number(it.quantity || 0), 0) || 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-5 py-3.5 rounded-xl shadow-xl border border-slate-700 flex items-center gap-3 max-w-md animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium leading-relaxed">{toastMessage}</span>
        </div>
      )}

      {/* Top Bar Contract */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            onClick={() => setActiveTab('receipts')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            SmartPantry 2.0
          </button>

          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
            <button
              onClick={() => setActiveTab('receipts')}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'receipts'
                  ? 'border-emerald-600 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              1. Leitura de NF
            </button>
            <button
              onClick={() => setActiveTab('classification')}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'classification'
                  ? 'border-emerald-600 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              2. Classificação ({pendingClassification.length})
            </button>
            <button
              onClick={() => setActiveTab('pantry')}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'pantry'
                  ? 'border-emerald-600 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              3. Dispensa ({pantryItems.length})
            </button>
            <button
              onClick={() => setActiveTab('shopping')}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'shopping'
                  ? 'border-emerald-600 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              4. Lista de Compras
            </button>
            <button
              onClick={() => setActiveTab('comparison')}
              className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'comparison'
                  ? 'border-emerald-600 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              5. Pós-Compra
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden lg:inline text-xs text-slate-500 truncate max-w-[160px]">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {/* =====================================================================
            ETAPA 1: LEITURA DE NOTA FISCAL (FOTO JPG -> TRANSCRIÇÃO + CSV PREVIEW)
           ===================================================================== */}
        {activeTab === 'receipts' && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  1. Leitura de Nota Fiscal (JPG para CSV)
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Envie a foto da NF. O sistema lê e transcreve a nota na íntegra (usando OCR Óptico Local Gratuito + IA) e gera o preview em memória para sua conferência antes de importar.
                </p>
              </div>
              <button
                onClick={() => {
                  setPreviewReceipt({
                    establishment: 'Supermercado',
                    purchaseDate: new Date().toISOString().split('T')[0],
                    rawTranscription: '',
                    items: [
                      {
                        rawName: 'COXA DE FRANGO KG',
                        classification: 'Coxa de Frango',
                        quantity: 2,
                        unit: 'kg',
                        unitPrice: 14.9,
                        totalPrice: 29.8,
                        category: 'Açougue',
                      },
                    ],
                    source: 'manual',
                  });
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                + Criar Nota Manualmente
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Coluna Esquerda: Upload da Foto + Transcrição na Íntegra */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-5">
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Camera className="w-5 h-5 text-emerald-600" />
                    Enviar Foto da NF (JPG / PNG)
                  </h2>

                  <div className="border-2 border-dashed border-emerald-300 rounded-xl p-6 text-center hover:border-emerald-600 transition-colors cursor-pointer relative bg-emerald-50/30">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/*"
                      onChange={handleImageUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <div className="space-y-2">
                      <Upload className="w-8 h-8 text-emerald-600 mx-auto" />
                      <p className="text-sm font-semibold text-slate-800">
                        Selecionar Foto da Nota Fiscal
                      </p>
                      <p className="text-xs text-slate-500">
                        Lê e transcreve automaticamente sem erro 503
                      </p>
                    </div>
                  </div>

                  {isProcessingPhoto && (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span>{ocrStatusText || 'Lendo Nota Fiscal...'}</span>
                        <span className="tabular-nums">{ocrProgress}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 transition-all duration-200"
                          style={{ width: `${Math.max(10, ocrProgress)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {selectedImageDataUrl && (
                    <div className="space-y-3">
                      <div className="max-h-48 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center">
                        <img
                          src={selectedImageDataUrl}
                          alt="Miniatura da Nota Fiscal enviada"
                          referrerPolicy="no-referrer"
                          className="max-h-48 w-auto object-contain"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() =>
                            selectedImageBase64 &&
                            executeFullReceiptReading(
                              selectedImageBase64,
                              selectedImageDataUrl,
                              imageMime,
                              true
                            )
                          }
                          disabled={isProcessingPhoto}
                          className="py-2 px-3 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Relê com OCR Local
                        </button>
                        <button
                          onClick={() =>
                            selectedImageBase64 &&
                            executeFullReceiptReading(
                              selectedImageBase64,
                              selectedImageDataUrl,
                              imageMime,
                              false
                            )
                          }
                          disabled={isProcessingPhoto}
                          className="py-2 px-3 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Relê Híbrido (IA+OCR)
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Transcrição na Íntegra */}
                <div className="bg-white p-6 rounded-xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      Transcrição na Íntegra da NF
                    </h2>
                    <span className="text-xs text-slate-500">
                      {rawTranscription ? `${rawTranscription.split('\n').length} linhas` : 'Editável'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Texto lido da foto da NF (ou cole o texto do cupom aqui para converter em CSV):
                  </p>
                  <textarea
                    rows={8}
                    value={rawTranscription}
                    onChange={(e) => setRawTranscription(e.target.value)}
                    placeholder="Ex:&#10;SUPERMERCADO MUNDIAL&#10;15/10/2026&#10;001 ARROZ 5KG 2 UN X 24,90 49,80&#10;002 ALCATRA PECA 1,500 KG X 39,90 59,85"
                    className="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={handleReparseFromTranscription}
                    className="w-full py-2.5 px-4 text-xs font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors cursor-pointer"
                  >
                    Extrair Itens da Transcrição Acima
                  </button>
                </div>
              </div>

              {/* Coluna Direita: Preview em Memória (dados.csv) com Contagem de Linhas e Conferência */}
              <div className="lg:col-span-8 bg-white p-6 rounded-xl border border-slate-200 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Preview na Memória do Navegador (dados.csv)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Confira as linhas lidas, edite, adicione ou remova itens antes de importar para o banco de dados.
                    </p>
                  </div>

                  {previewReceipt && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowCsvModal(!showCsvModal)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        {showCsvModal ? 'Ver Tabela' : 'Ver CSV Bruto'}
                      </button>
                      <button
                        onClick={handleDownloadCsv}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar dados.csv
                      </button>
                    </div>
                  )}
                </div>

                {previewReceipt ? (
                  <div className="space-y-6">
                    {/* Resumo de Conferência (Contagem de linhas, itens e valor total) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div>
                        <span className="text-xs text-slate-500 block">Linhas de Itens na NF</span>
                        <span className="text-lg font-bold text-slate-900 tabular-nums">
                          {previewReceipt.items.length} linhas
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 block">Soma de Quantidades</span>
                        <span className="text-lg font-bold text-slate-900 tabular-nums">
                          {totalPreviewUnits.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 block">Total Calculado da NF</span>
                        <span className="text-lg font-bold text-emerald-700 tabular-nums">
                          R$ {totalPreviewValue.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 block">Método de Leitura</span>
                        <span className="text-sm font-semibold text-slate-800">
                          {previewReceipt.source === 'gemini'
                            ? 'IA + Transcrição'
                            : 'OCR Óptico Local'}
                        </span>
                      </div>
                    </div>

                    {/* Cabeçalho da NF: Estabelecimento e Data */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-slate-700 mb-1 block">
                          Estabelecimento Comprado:
                        </label>
                        <input
                          type="text"
                          value={previewReceipt.establishment}
                          onChange={(e) =>
                            setPreviewReceipt({ ...previewReceipt, establishment: e.target.value })
                          }
                          className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700 mb-1 block">
                          Data da Compra:
                        </label>
                        <input
                          type="date"
                          value={previewReceipt.purchaseDate}
                          onChange={(e) =>
                            setPreviewReceipt({ ...previewReceipt, purchaseDate: e.target.value })
                          }
                          className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-semibold text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>

                    {showCsvModal ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-600">
                          Conteúdo estruturado de <code className="font-mono">dados.csv</code>:
                        </p>
                        <pre className="p-4 bg-slate-900 text-emerald-400 text-xs font-mono rounded-xl overflow-x-auto leading-relaxed">
                          {generateCSVFromReceipt(
                            previewReceipt.establishment,
                            previewReceipt.purchaseDate,
                            previewReceipt.items
                          )}
                        </pre>
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                              <th className="p-2.5 w-10 text-center">#</th>
                              <th className="p-2.5">Nome Real (NF)</th>
                              <th className="p-2.5">Classificação Sugerida</th>
                              <th className="p-2.5 w-20">Qtd</th>
                              <th className="p-2.5 w-16">Unid.</th>
                              <th className="p-2.5 w-24">Preço Unit.</th>
                              <th className="p-2.5 w-28">Qtd x Preço</th>
                              <th className="p-2.5 w-10"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {previewReceipt.items.map((item, idx) => {
                              const rowTotal = Number((item.quantity * item.unitPrice).toFixed(2));
                              return (
                                <tr key={idx} className="hover:bg-slate-50/70">
                                  <td className="p-2 text-center font-mono text-slate-400 tabular-nums">
                                    {idx + 1}
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="text"
                                      value={item.rawName}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        const auto = autoClassifyItem(val, catalogItems);
                                        setPreviewReceipt({
                                          ...previewReceipt,
                                          items: previewReceipt.items.map((it, i) =>
                                            i === idx
                                              ? {
                                                  ...it,
                                                  rawName: val,
                                                  classification:
                                                    it.classification || auto.classification,
                                                }
                                              : it
                                          ),
                                        });
                                      }}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-900 focus:bg-white"
                                      placeholder="Nome impresso na nota"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="text"
                                      list="standard-classifications"
                                      value={item.classification}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setPreviewReceipt({
                                          ...previewReceipt,
                                          items: previewReceipt.items.map((it, i) =>
                                            i === idx ? { ...it, classification: val } : it
                                          ),
                                        });
                                      }}
                                      className="w-full bg-emerald-50/50 border border-emerald-200 rounded px-2 py-1.5 text-xs font-semibold text-emerald-900 focus:bg-white"
                                      placeholder="Ex: Arroz 5kg"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={item.quantity}
                                      onChange={(e) => {
                                        const qty = parseFloat(e.target.value) || 0;
                                        setPreviewReceipt({
                                          ...previewReceipt,
                                          items: previewReceipt.items.map((it, i) =>
                                            i === idx
                                              ? {
                                                  ...it,
                                                  quantity: qty,
                                                  totalPrice: Number((qty * it.unitPrice).toFixed(2)),
                                                }
                                              : it
                                          ),
                                        });
                                      }}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs text-center tabular-nums"
                                    />
                                  </td>
                                  <td className="p-2">
                                    <select
                                      value={item.unit}
                                      onChange={(e) => {
                                        const u = e.target.value;
                                        setPreviewReceipt({
                                          ...previewReceipt,
                                          items: previewReceipt.items.map((it, i) =>
                                            i === idx ? { ...it, unit: u } : it
                                          ),
                                        });
                                      }}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-1 py-1.5 text-xs"
                                    >
                                      <option value="un">un</option>
                                      <option value="kg">kg</option>
                                      <option value="L">L</option>
                                      <option value="pct">pct</option>
                                      <option value="g">g</option>
                                    </select>
                                  </td>
                                  <td className="p-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={item.unitPrice}
                                      onChange={(e) => {
                                        const price = parseFloat(e.target.value) || 0;
                                        setPreviewReceipt({
                                          ...previewReceipt,
                                          items: previewReceipt.items.map((it, i) =>
                                            i === idx
                                              ? {
                                                  ...it,
                                                  unitPrice: price,
                                                  totalPrice: Number((it.quantity * price).toFixed(2)),
                                                }
                                              : it
                                          ),
                                        });
                                      }}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-xs tabular-nums"
                                    />
                                  </td>
                                  <td className="p-2 font-mono font-semibold text-slate-900 tabular-nums">
                                    R$ {rowTotal.toFixed(2)}
                                  </td>
                                  <td className="p-2 text-center">
                                    <button
                                      onClick={() =>
                                        setPreviewReceipt({
                                          ...previewReceipt,
                                          items: previewReceipt.items.filter((_, i) => i !== idx),
                                        })
                                      }
                                      className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                      title="Remover linha"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                      <button
                        onClick={() =>
                          setPreviewReceipt({
                            ...previewReceipt,
                            items: [
                              ...previewReceipt.items,
                              {
                                rawName: '',
                                classification: '',
                                quantity: 1,
                                unit: 'un',
                                unitPrice: 0,
                                totalPrice: 0,
                                category: 'Mercearia',
                              },
                            ],
                          })
                        }
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Adicionar Linha na Nota
                      </button>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setPreviewReceipt(null)}
                          className="px-4 py-2.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                        >
                          Limpar Preview
                        </button>
                        <button
                          onClick={importReceiptToDatabase}
                          className="flex items-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          Importar e Ir para Classificação ({previewReceipt.items.length} itens)
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-72 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
                    <Receipt className="w-12 h-12 mb-3 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-700">
                      Nenhuma Nota Fiscal em conferência no momento
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-md">
                      Envie uma foto JPG ao lado para transcrever na íntegra automaticamente ou cole o texto da nota para gerar o preview editável.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            ETAPA 2: CLASSIFICAÇÃO DE PRODUTOS E ENVIO PARA DISPENSA
           ===================================================================== */}
        {activeTab === 'classification' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  2. Classificação Padronizada dos Itens da Nota
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Verifique a classificação sugerida para cada item (ex: Coxa de Frango, Alcatra Peça, Arroz 1kg, Arroz 5kg, Feijão 1kg, Macarrão Espaguete) e envie para a Dispensa.
                </p>
              </div>
              {pendingClassification.length > 0 && (
                <button
                  onClick={sendAllClassifiedToPantry}
                  className="flex items-center gap-2 bg-emerald-600 text-white font-semibold py-2.5 px-5 rounded-lg hover:bg-emerald-700 transition-colors text-xs shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CheckCircle className="w-4 h-4" />
                  Validar Todos e Enviar para Dispensa ({pendingClassification.length})
                </button>
              )}
            </div>

            {pendingClassification.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
                <Layers className="w-12 h-12 text-slate-300 mx-auto" />
                <div>
                  <h3 className="text-base font-semibold text-slate-800">
                    Todos os itens já foram classificados e enviados para a Dispensa!
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Importe uma nova Nota Fiscal na aba 1 ou acesse sua Dispensa na aba 3.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={() => setActiveTab('receipts')}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    Importar Nova NF
                  </button>
                  <button
                    onClick={() => setActiveTab('pantry')}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
                  >
                    Ver Dispensa
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {pendingClassification.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-5"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{item.establishment}</span>
                        <span>·</span>
                        <span className="tabular-nums">R$ {item.unitPrice.toFixed(2)} / {item.unit}</span>
                      </div>

                      <div>
                        <span className="text-xs text-slate-400 block">Nome Real na Nota Fiscal:</span>
                        <p className="text-sm font-semibold text-slate-800 mt-0.5">{item.rawName}</p>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-slate-700 block mb-1">
                          Classificação Padronizada:
                        </label>
                        <input
                          type="text"
                          list="standard-classifications"
                          value={item.classification}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPendingClassification((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, classification: val } : it))
                            );
                          }}
                          className="w-full text-sm font-semibold text-emerald-950 bg-emerald-50/60 border border-emerald-300 rounded-lg px-3 py-2 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Quantidade:</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) => {
                              const q = parseFloat(e.target.value) || 0;
                              setPendingClassification((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, quantity: q } : it))
                              );
                            }}
                            className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Unidade:</label>
                          <select
                            value={item.unit}
                            onChange={(e) => {
                              const u = e.target.value;
                              setPendingClassification((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, unit: u } : it))
                              );
                            }}
                            className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"
                          >
                            <option value="kg">kg</option>
                            <option value="un">un</option>
                            <option value="L">L</option>
                            <option value="pct">pct</option>
                            <option value="g">g</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Setor:</label>
                          <select
                            value={item.category}
                            onChange={(e) => {
                              const c = e.target.value;
                              setPendingClassification((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, category: c } : it))
                              );
                            }}
                            className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"
                          >
                            <option value="Açougue">Açougue</option>
                            <option value="Mercearia">Mercearia</option>
                            <option value="Hortifruti">Hortifruti</option>
                            <option value="Laticínios">Laticínios</option>
                            <option value="Padaria">Padaria</option>
                            <option value="Limpeza">Limpeza</option>
                            <option value="Higiene">Higiene</option>
                            <option value="Bebidas">Bebidas</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => sendItemToPantry(item, idx)}
                      className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-semibold py-2.5 px-4 rounded-lg hover:bg-slate-800 transition-colors text-xs cursor-pointer"
                    >
                      Validar e Enviar para Dispensa
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <datalist id="standard-classifications">
              {STANDARD_CLASSIFICATION_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
              {catalogItems.map((c) => (
                <option key={c.id} value={c.classification} />
              ))}
            </datalist>
          </div>
        )}

        {/* =====================================================================
            ETAPA 3: DISPENSA (VISUALIZAÇÃO DIRETA, PROPORÇÃO 1 / 5 KG E OPACIDADE ZERO)
           ===================================================================== */}
        {activeTab === 'pantry' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">3. Controle Prático da Dispensa</h1>
                <p className="text-sm text-slate-600 mt-1">
                  Remova ou zere o que acabou antes de gerar as compras. Itens zerados não somem: ganham opacidade reduzida indicando <span className="font-mono font-semibold">0 / Qtd Inicial</span>.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('shopping')}
                className="flex items-center gap-2 bg-emerald-600 text-white font-semibold py-2.5 px-5 rounded-lg hover:bg-emerald-700 transition-colors text-xs shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                Configurar e Gerar Lista de Compras
              </button>
            </div>

            {pantryItems.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
                <Package className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="text-base font-semibold text-slate-800">Sua Dispensa está vazia</h3>
                <p className="text-xs text-slate-500">
                  Importe uma Nota Fiscal na etapa 1 e valide os itens na etapa 2 para abastecer sua dispensa.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {pantryItems.map((item) => {
                  const isZero = Number(item.quantity) <= 0;
                  const initialQty = Number(item.initialQuantity) || Math.max(1, Number(item.quantity));
                  return (
                    <div
                      key={item.id}
                      className={`bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4 transition-opacity duration-150 ${
                        isZero ? 'opacity-40 bg-slate-100/70' : 'opacity-100'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{item.category || 'Mercearia'}</span>
                          <span>·</span>
                          <span>
                            Última compra:{' '}
                            {item.lastPurchaseDate
                              ? new Date(item.lastPurchaseDate + 'T12:00:00').toLocaleDateString('pt-BR')
                              : new Date(item.lastUpdated).toLocaleDateString('pt-BR')}
                          </span>
                        </div>

                        <h3 className="text-base font-bold text-slate-900">{item.classification}</h3>

                        <div className="flex items-baseline justify-between pt-2">
                          <span className="text-xs text-slate-500">Estoque / Compra Inicial:</span>
                          <span className="text-base font-mono font-bold text-slate-900 tabular-nums">
                            {item.quantity} / {initialQty} {item.unit || 'un'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => updatePantryStock(item, item.quantity - 1)}
                            disabled={isZero}
                            className="px-2.5 py-1.5 text-xs font-bold bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
                            title="Reduzir 1 unidade/kg"
                          >
                            -1
                          </button>
                          <button
                            onClick={() => updatePantryStock(item, 0)}
                            disabled={isZero}
                            className="px-3 py-1.5 text-xs font-semibold bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 disabled:opacity-40 cursor-pointer"
                          >
                            Zerar da Dispensa
                          </button>
                        </div>

                        {isZero && (
                          <button
                            onClick={() => updatePantryStock(item, initialQty)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 cursor-pointer"
                            title="Restaurar quantidade inicial"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Repor
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            ETAPA 4: LISTA DE COMPRAS INTELIGENTE (CONFIGURAÇÃO + MOTOR DE PREÇOS + APRENDIZADO)
           ===================================================================== */}
        {activeTab === 'shopping' && (
          <div className="space-y-8">
            <div className="border-b border-slate-200 pb-5">
              <h1 className="text-2xl font-bold text-slate-900">
                4. Lista de Compras Inteligente e Previsão de Custo
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Configure o período e a estratégia de mercado antes de gerar a lista. O sistema cruza o que acabou na Dispensa com o histórico de preços das Notas Fiscais e aprende com cada ajuste seu.
              </p>
            </div>

            {/* Janela de Configuração Pré-Lista */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-emerald-600" />
                Configurações da Próxima Compra (Configure antes de gerar)
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-2">
                    1. Período de Duração das Compras:
                  </label>
                  <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-lg">
                    {[5, 7, 15, 30].map((days) => (
                      <button
                        key={days}
                        onClick={() => setIntervalDays(days)}
                        className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          intervalDays === days
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {days} dias
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-2">
                    2. Estratégia de Mercado:
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                    <button
                      onClick={() => setStrategy('multiple')}
                      className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        strategy === 'multiple'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Vários Mercados (Menor Preço)
                    </button>
                    <button
                      onClick={() => setStrategy('single')}
                      className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        strategy === 'single'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Único Mercado
                    </button>
                  </div>
                </div>

                <div>
                  {strategy === 'single' ? (
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-2">
                        3. Selecionar Mercado Único:
                      </label>
                      <select
                        value={selectedSingleMarket}
                        onChange={(e) => setSelectedSingleMarket(e.target.value)}
                        className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5"
                      >
                        <option value="">Automático (Mercado com menor total)</option>
                        {knownMarkets.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-2">
                        3. Organização da Lista:
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                        <button
                          onClick={() => setGroupByMode('market')}
                          className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                            groupByMode === 'market'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Por Mercado e Setor
                        </button>
                        <button
                          onClick={() => setGroupByMode('aisle')}
                          className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                            groupByMode === 'aisle'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Apenas por Setor
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end pt-2">
                <button
                  onClick={handleGenerateSmartList}
                  className="flex items-center gap-2 bg-emerald-600 text-white font-semibold py-2.5 px-6 rounded-lg hover:bg-emerald-700 transition-colors text-xs shadow-sm cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  Gerar Lista de Compras ({intervalDays} dias)
                </button>
              </div>
            </div>

            {/* Banner de Confirmação de Aprendizado */}
            {pendingLearningPrompt && (
              <div className="bg-slate-900 text-white p-5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Brain className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Confirmação de Aprendizado Inteligente
                    </h3>
                    <p className="text-sm text-slate-200 mt-1">
                      {pendingLearningPrompt.actionDescription}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => confirmLearningRule(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 rounded-lg hover:bg-slate-700 cursor-pointer"
                  >
                    Apenas desta vez
                  </button>
                  <button
                    onClick={() => confirmLearningRule(true)}
                    className="px-4 py-1.5 text-xs font-semibold text-slate-900 bg-emerald-400 rounded-lg hover:bg-emerald-300 cursor-pointer"
                  >
                    Sim, Aprender Padrão
                  </button>
                </div>
              </div>
            )}

            {currentShoppingList ? (
              <div className="space-y-6">
                {/* Resumo de Previsão de Custo e Estratégia */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white border border-slate-200 rounded-xl p-6">
                    <span className="text-xs text-slate-500">Previsão de Custo da Lista</span>
                    <p className="text-3xl font-bold text-slate-900 mt-1 tabular-nums">
                      R$ {currentShoppingList.estimatedCost.toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      {currentShoppingList.items.length} itens · Duração planejada:{' '}
                      {currentShoppingList.intervalDays} dias
                    </p>
                  </div>

                  <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Análise de Preços e Recomendação de Mercados
                      </h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {currentShoppingList.suggestions}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                      <span className="text-xs text-slate-500">
                        Mercado principal sugerido:{' '}
                        <strong className="text-slate-900">
                          {currentShoppingList.recommendedMarket}
                        </strong>
                      </span>
                      <button
                        onClick={handleRunComparison}
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        Comparar Lista com Última NF Importada
                      </button>
                    </div>
                  </div>
                </div>

                {/* Adicionar item manual à Lista */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <h3 className="text-xs font-bold text-slate-700">
                    Adicionar Item Manualmente à Lista (O sistema aprenderá sua adição):
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
                    <input
                      type="text"
                      list="standard-classifications"
                      placeholder="Ex: Alcatra Peça"
                      value={newManualListItem.classification}
                      onChange={(e) =>
                        setNewManualListItem({ ...newManualListItem, classification: e.target.value })
                      }
                      className="sm:col-span-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
                    />
                    <input
                      type="number"
                      step="0.5"
                      placeholder="Qtd"
                      value={newManualListItem.quantity}
                      onChange={(e) =>
                        setNewManualListItem({
                          ...newManualListItem,
                          quantity: parseFloat(e.target.value) || 1,
                        })
                      }
                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 tabular-nums"
                    />
                    <select
                      value={newManualListItem.aisle}
                      onChange={(e) =>
                        setNewManualListItem({ ...newManualListItem, aisle: e.target.value })
                      }
                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-2"
                    >
                      <option value="Açougue">Açougue</option>
                      <option value="Mercearia">Mercearia</option>
                      <option value="Hortifruti">Hortifruti</option>
                      <option value="Laticínios">Laticínios</option>
                      <option value="Limpeza">Limpeza</option>
                      <option value="Padaria">Padaria</option>
                      <option value="Bebidas">Bebidas</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Preço Est. R$"
                      value={newManualListItem.estimatedPrice}
                      onChange={(e) =>
                        setNewManualListItem({
                          ...newManualListItem,
                          estimatedPrice: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 tabular-nums"
                    />
                    <button
                      onClick={handleAddManualItemToShoppingList}
                      className="bg-slate-900 text-white text-xs font-semibold rounded-lg px-4 py-2 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      + Incluir Item
                    </button>
                  </div>
                </div>

                {/* Tabela da Lista de Compras Organizada por Mercado / Setor */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="p-3">Item Classificado</th>
                        <th className="p-3">Setor</th>
                        <th className="p-3">Mercado Sugerido (Menor Preço)</th>
                        <th className="p-3">Quantidade</th>
                        <th className="p-3">Preço Unit. Hist.</th>
                        <th className="p-3">Subtotal Previsto</th>
                        <th className="p-3">Motivo / Estoque</th>
                        <th className="p-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...currentShoppingList.items]
                        .sort((a, b) =>
                          groupByMode === 'market'
                            ? a.market.localeCompare(b.market) || a.aisle.localeCompare(b.aisle)
                            : a.aisle.localeCompare(b.aisle)
                        )
                        .map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70">
                            <td className="p-3 font-bold text-slate-900">{item.classification}</td>
                            <td className="p-3 text-slate-600">{item.aisle}</td>
                            <td className="p-3 font-semibold text-emerald-800">{item.market}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() =>
                                    handleUpdateShoppingItemQty(
                                      item.classification,
                                      Number((item.quantity - 1).toFixed(2))
                                    )
                                  }
                                  className="w-6 h-6 bg-slate-100 rounded flex items-center justify-center font-bold hover:bg-slate-200 cursor-pointer"
                                >
                                  -
                                </button>
                                <span className="font-mono font-bold text-slate-900 min-w-[44px] text-center tabular-nums">
                                  {item.quantity} {item.unit}
                                </span>
                                <button
                                  onClick={() =>
                                    handleUpdateShoppingItemQty(
                                      item.classification,
                                      Number((item.quantity + 1).toFixed(2))
                                    )
                                  }
                                  className="w-6 h-6 bg-slate-100 rounded flex items-center justify-center font-bold hover:bg-slate-200 cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="p-3 font-mono text-slate-600 tabular-nums">
                              R$ {item.estimatedPrice.toFixed(2)}
                            </td>
                            <td className="p-3 font-mono font-bold text-slate-900 tabular-nums">
                              R$ {item.totalEstimated.toFixed(2)}
                            </td>
                            <td className="p-3 text-slate-500">{item.reason}</td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => handleRemoveShoppingItem(item.classification)}
                                className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                title="Remover item da lista"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
                <ShoppingCart className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="text-base font-semibold text-slate-800">
                  Configure as opções acima e clique em "Gerar Lista de Compras"
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  O sistema lerá os itens zerados ou baixos na sua Dispensa e cruzará com os preços das Notas Fiscais já importadas.
                </p>
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            ETAPA 5: COMPARATIVO PÓS-COMPRA (NF IMPORTADA VS LISTA DE COMPRAS)
           ===================================================================== */}
        {activeTab === 'comparison' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  5. Comparativo Pós-Compra (Lista Planejada vs. Nota Fiscal)
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Ao importar uma nova NF após ter gerado uma lista, o sistema compara o que foi comprado com o que estava planejado e questiona divergências para aprender seu hábito real.
                </p>
              </div>
              <button
                onClick={handleRunComparison}
                className="flex items-center gap-2 bg-emerald-600 text-white font-semibold py-2.5 px-5 rounded-lg hover:bg-emerald-700 transition-colors text-xs shadow-sm whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Atualizar Comparativo Agora
              </button>
            </div>

            {comparisonResult ? (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Nota Fiscal comparada:{' '}
                      <strong className="text-slate-800">
                        {comparisonResult.purchaseEstablishment || 'Última Compra'}
                      </strong>
                    </span>
                    <span>Data: {comparisonResult.purchaseDate || 'Recente'}</span>
                  </div>
                  <h2 className="text-base font-bold text-slate-900">Resumo de Conformidade</h2>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {comparisonResult.divergenceSummary}
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Brain className="w-5 h-5 text-emerald-600" />
                    Questionamentos de Divergências para Aprendizado
                  </h3>

                  {comparisonResult.divergences.length === 0 ? (
                    <p className="text-sm text-emerald-700 font-medium">
                      Parabéns! Sua compra na Nota Fiscal bateu exatamente com as quantidades planejadas na Lista de Compras.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {comparisonResult.divergences.map((div, idx) => (
                        <div
                          key={div.id}
                          className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
                        >
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span className="font-semibold text-slate-800">
                              {idx + 1}. {div.classification}
                            </span>
                            <span className="font-mono tabular-nums">
                              Planejado: {div.plannedQty} {div.unit} · Comprado na NF: {div.boughtQty}{' '}
                              {div.unit}
                            </span>
                          </div>

                          <p className="text-sm font-medium text-slate-900">{div.question}</p>

                          {div.resolved ? (
                            <p className="text-xs font-semibold text-emerald-700">
                              ✓ Aprendizado registrado: "{div.answer}"
                            </p>
                          ) : (
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <input
                                type="text"
                                placeholder="Explique o motivo (ex: estava mais barato, embalagem de 4kg, etc.)"
                                value={div.answer || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setComparisonResult({
                                    ...comparisonResult,
                                    divergences: comparisonResult.divergences.map((d, i) =>
                                      i === idx ? { ...d, answer: val } : d
                                    ),
                                  });
                                }}
                                className="flex-1 text-xs bg-white border border-slate-200 rounded-lg px-3 py-2"
                              />
                              <button
                                onClick={() => {
                                  if (div.boughtQty > 0) {
                                    setLearningAdjustments((prev) => ({
                                      ...prev,
                                      [div.classification]: { preferredQty: div.boughtQty },
                                    }));
                                  }
                                  setComparisonResult({
                                    ...comparisonResult,
                                    divergences: comparisonResult.divergences.map((d, i) =>
                                      i === idx
                                        ? {
                                            ...d,
                                            resolved: true,
                                            answer:
                                              d.answer ||
                                              `Padrão ajustado para ${div.boughtQty} ${div.unit}`,
                                          }
                                        : d
                                    ),
                                  });
                                  showToast(
                                    `Aprendizado salvo! Próximas listas considerarão seu hábito para "${div.classification}".`
                                  );
                                }}
                                className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                              >
                                Aprender Novo Padrão ({div.boughtQty} {div.unit})
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
                <BarChart3 className="w-12 h-12 text-slate-300 mx-auto" />
                <div>
                  <h3 className="text-base font-semibold text-slate-800">
                    Nenhum comparativo executado ainda
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Gere uma Lista de Compras na aba 4 e depois importe a foto da NF da compra realizada (ou clique no botão abaixo para comparar com a última NF importada).
                  </p>
                </div>
                <button
                  onClick={handleRunComparison}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer"
                >
                  Comparar Lista Atual com Última NF
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
