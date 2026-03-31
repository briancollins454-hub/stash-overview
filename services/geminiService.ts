
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { UnifiedOrder, AiMappingSuggestion } from '../types';

export const analyzeBusinessData = async (
  orders: UnifiedOrder[], 
  userQuery: string,
  history: {role: 'user'|'model', text: string}[] = []
) => {
  // Initialize ONLY when needed to prevent top-level runtime errors
  // Always use process.env.GEMINI_API_KEY directly as per guidelines
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Construct a context-rich prompt
  const dataSummary = orders.map(o => {
    return `
      [Shopify Order #${o.shopify.orderNumber}]
      Club/Tag: ${o.clubName}
      Date: ${o.shopify.date}
      Working Days in Production: ${o.daysInProduction}/20
      Status: ${o.productionStatus}
      Deco Job: ${o.deco ? o.deco.jobNumber : 'None'}
      Linked Via: ${o.matchStatus}
      Items Ready: ${o.completionPercentage}%
    `;
  }).join('\n');

  const systemInstruction = `
    You are an expert Production Manager for 'Stash Shop'.
    
    The Business Rules (Confirmed):
    1. **Club Shops:** Identified by Shopify Tags (e.g., 'Omagh Rugby'). Orders are batched every 5 days.
    2. **SLA:** 20 working days is the standard lead time.
    3. **Linking:** We link Shopify Orders to DecoNetwork Jobs by reading comments in the Shopify Timeline (e.g., "Deco Job: 885231").
    4. **Status Meanings:**
       - **Not Ordered:** Order is > 5 days old and has NO 6-digit PO code in the timeline. This is critical.
       - **Ready to Ship:** All items in the order are marked completed in DecoNetwork.
    
    Your Role:
    1. Identify 'Not Ordered' items - these are missed batches.
    2. Identify late orders based on the 20-working-day rule.
    3. Draft emails to customers if they are late.
    
    Context Data (Current Dashboard State):
    ${dataSummary}
    
    Tone: Professional, proactive, and specific. Always use real Order Numbers from the data provided.
  `;

  try {
    // Corrected generateContent call to use gemini-3-pro-preview for complex reasoning tasks
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Conversation History:\n${JSON.stringify(history)}\n\nCurrent Question: ${userQuery}`,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      }
    });

    // Access .text property directly as per guidelines
    return response.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Sorry, I encountered an error analyzing your data.";
  }
};

export const suggestMapping = async (
  shopifyItems: any[],
  decoItems: any[]
): Promise<AiMappingSuggestion[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  // 1. Local Exact Matching (Instant)
  const suggestions: AiMappingSuggestion[] = [];
  const remainingShopifyItems: any[] = [];

  for (const sItem of shopifyItems) {
    // Try to find an exact SKU or Name match locally first
    const exactMatch = decoItems.find(d => {
      const dSku = (d.vendorSku || d.productCode || '').toLowerCase();
      const sSku = (sItem.sku || '').toLowerCase();
      return (sSku && dSku === sSku) || (d.name.toLowerCase() === sItem.name.toLowerCase());
    });

    if (exactMatch) {
      suggestions.push({
        shopifyItemId: sItem.id,
        decoItemName: exactMatch.name,
        confidence: 1.0,
        reason: "Exact match (Local)"
      });
    } else {
      remainingShopifyItems.push(sItem);
    }
  }

  // If everything matched locally, return immediately
  if (remainingShopifyItems.length === 0) return suggestions;

  const systemInstruction = `
    You are a production mapping assistant for 'Stash Shop'.
    Your task is to match Shopify order items to DecoNetwork job items.
    
    Rules:
    1. Match based on product name, color, and size.
    2. Shopify names often include size at the end (e.g., "T-Shirt - Blue - XL").
    3. DecoNetwork names might be more technical.
    4. Provide a confidence score (0.0 to 1.0).
    5. Provide a brief reason for the match.
    
    Return ONLY a JSON array of mappings.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        Shopify Items: ${JSON.stringify(remainingShopifyItems.map(i => ({ id: i.id, name: i.name, sku: i.sku })))}
        DecoNetwork Job Items: ${JSON.stringify(decoItems.map(i => ({ name: i.name, productCode: i.productCode })))}
      `,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              shopifyItemId: { type: Type.STRING },
              decoItemName: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              reason: { type: Type.STRING }
            },
            required: ["shopifyItemId", "decoItemName", "confidence", "reason"]
          }
        }
      }
    });

    const aiSuggestions = JSON.parse(response.text || "[]");
    return [...suggestions, ...aiSuggestions];
  } catch (error) {
    console.error("Gemini Mapping Error:", error);
    return suggestions; // Return at least the local matches
  }
};
