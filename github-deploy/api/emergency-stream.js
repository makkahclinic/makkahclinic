export const config = {
  runtime: 'edge',
};

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbytslZrI7jIgUY0iavZPfgOiEPZKgkjFaNgTBCcWByHLARdEFb4Qkzi4Ecad0v_Q7SL1w/exec';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const encoder = new TextEncoder();
  let lastCommandJson = '';
  let isActive = true;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const checkForUpdates = async () => {
        if (!isActive) return;
        
        try {
          const response = await fetch(`${APPS_SCRIPT_URL}?action=getActiveCommand`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });
          
          if (response.ok) {
            const data = await response.json();
            const currentStateJson = JSON.stringify(data);
            
            if (currentStateJson !== lastCommandJson) {
              lastCommandJson = currentStateJson;
              if (data && data.ok && data.command && data.command.active) {
                sendEvent({ command: data.command });
              } else {
                sendEvent({ command: null, cleared: true });
              }
            }
          }
        } catch (error) {
          sendEvent({ error: 'Connection error', retry: true });
        }

        if (isActive) {
          setTimeout(checkForUpdates, 1000);
        }
      };

      sendEvent({ connected: true, timestamp: Date.now() });
      checkForUpdates();
    },
    
    cancel() {
      isActive = false;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    },
  });
}
