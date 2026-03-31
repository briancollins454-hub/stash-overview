import { UnifiedOrder } from '../types';

const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'];
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

// Dynamic script loader
const loadScript = (src: string) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve(true);
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve(true);
        script.onerror = reject;
        document.body.appendChild(script);
    });
};

export const initializeGoogleApi = async (clientId: string) => {
    if (!clientId) throw new Error("Google Client ID is missing.");

    await loadScript('https://apis.google.com/js/api.js');
    await loadScript('https://accounts.google.com/gsi/client');

    return new Promise<void>((resolve, reject) => {
        // Initialize GAPI
        (window as any).gapi.load('client', async () => {
            await (window as any).gapi.client.init({
                discoveryDocs: DISCOVERY_DOCS,
            });
            gapiInited = true;
            checkAuth();
        });

        // Initialize GIS (Google Identity Services)
        tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: '', // defined at request time
        });
        gisInited = true;
        checkAuth();

        function checkAuth() {
            if (gapiInited && gisInited) resolve();
        }
    });
};

export const checkForOrderEnquiries = async (clientId: string, orders: UnifiedOrder[]): Promise<string[]> => {
    if (!gapiInited || !gisInited) {
        await initializeGoogleApi(clientId);
    }

    console.log("Initiating Google Auth from Origin:", window.location.origin);

    return new Promise((resolve, reject) => {
        tokenClient.callback = async (resp: any) => {
            if (resp.error) {
                console.error("Google Auth Error:", resp);
                reject(resp);
            }
            // Auth success, now scan
            try {
                const results = await scanInbox(orders);
                resolve(results);
            } catch (e) {
                reject(e);
            }
        };

        // Aggressively force account selection
        // Note: In some sandboxes (like StackBlitz/AI Studio), this popup might be blocked by browser policies
        try {
            tokenClient.requestAccessToken({ prompt: 'select_account' });
        } catch (e) {
            reject(new Error("Popup Blocked by Sandbox"));
        }
    });
};

const scanInbox = async (orders: UnifiedOrder[]): Promise<string[]> => {
    // 1. List messages NOT from info@stashshop.co.uk
    // Limit to 50 for performance
    const response = await (window as any).gapi.client.gmail.users.messages.list({
        'userId': 'me',
        'q': '-from:info@stashshop.co.uk',
        'maxResults': 50
    });

    const messages = response.result.messages || [];
    const foundOrderNumbers = new Set<string>();
    const activeOrderNumbers = new Set(orders.map(o => o.shopify.orderNumber));

    // 2. Fetch details for each message (Batching ideally, but simple loop for now)
    const promises = messages.map(async (msg: any) => {
        try {
            const detail = await (window as any).gapi.client.gmail.users.messages.get({
                'userId': 'me',
                'id': msg.id,
                'format': 'metadata',
                'metadataHeaders': ['Subject', 'Snippet']
            });
            
            const subjectHeader = detail.result.payload.headers.find((h: any) => h.name === 'Subject');
            const subject = subjectHeader ? subjectHeader.value : '';
            const snippet = detail.result.snippet || '';
            const combinedText = `${subject} ${snippet}`;

            // 3. Match against order numbers
            const numberMatches = combinedText.match(/\b\d{4,}\b/g);
            if (numberMatches) {
                numberMatches.forEach((num: string) => {
                    if (activeOrderNumbers.has(num)) {
                        foundOrderNumbers.add(num);
                    }
                });
            }
        } catch (e) {
            console.warn("Failed to fetch email detail", e);
        }
    });

    await Promise.all(promises);
    return Array.from(foundOrderNumbers);
};

/**
 * SIMULATION MODE
 * Used when running in restricted sandboxes (like AI Studio) where Real OAuth is impossible.
 */
export const mockScanInbox = async (orders: UnifiedOrder[]): Promise<string[]> => {
    // Simulate a 1.5s delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Randomly pick 5% of orders to have "Enquiries"
    const shuffled = [...orders].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.max(1, Math.floor(orders.length * 0.2))); // Pick 20% or at least 1
    
    return selected.map(o => o.shopify.orderNumber);
};