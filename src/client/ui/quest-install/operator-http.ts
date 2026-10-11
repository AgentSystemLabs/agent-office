/** HTTP only to the on-device Operator. No LAN/server forwarding or arbitrary destination. */
export interface OperatorSocket {
  read(): Promise<{done: true; value?: Uint8Array} | {done: false; value: Uint8Array}>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
export function operatorFetch(open: () => Promise<OperatorSocket>): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== 'http://127.0.0.1:8720' || url.username || url.password || !['GET','POST'].includes(init.method ?? 'GET')) throw Error('Ungültiges Operator-Ziel');
    const signal = init.signal; signal?.throwIfAborted();
    let openingAborted=false;
    const opening=open().then(socket=>{if(openingAborted)void socket.close().catch(()=>{});return socket;});
    let rejectOpen!:()=>void;
    const aborted=new Promise<never>((_,reject)=>{rejectOpen=()=>{openingAborted=true;reject(signal?.reason??Error('Abgebrochen'));};});
    signal?.addEventListener('abort',rejectOpen,{once:true});
    let socket:OperatorSocket;
    try{if(signal?.aborted)rejectOpen();socket=await Promise.race([opening,aborted]);}finally{signal?.removeEventListener('abort',rejectOpen);}
    let closed = false;
    const close = async () => { if (closed) return; closed = true; signal?.removeEventListener('abort', abort); await socket.close().catch(() => {}); };
    const abort = () => { void close(); }; signal?.addEventListener('abort', abort, {once:true});
    let buffer = new Uint8Array(0);
    async function more() {
      signal?.throwIfAborted(); const result = await socket.read(); signal?.throwIfAborted();
      if (result.done) return false;
      const joined = new Uint8Array(buffer.length + result.value.length); joined.set(buffer); joined.set(result.value,buffer.length); buffer = joined; return true;
    }
    function take(n: number) { const result = buffer.slice(0,n); buffer=buffer.slice(n); return result; }
    async function line() {
      while (true) {
        const end=buffer.findIndex((b,i)=>b===13&&buffer[i+1]===10);
        if(end>=0){const value=new TextDecoder().decode(take(end));take(2);return value;}
        if(buffer.length>32768||!await more())throw Error('Ungültige Operator-HTTP-Antwort');
      }
    }
    try {
      signal?.throwIfAborted();
      const body = new TextEncoder().encode(typeof init.body === 'string' ? init.body : '');
      const head = new TextEncoder().encode(`${init.method ?? 'GET'} ${url.pathname+url.search} HTTP/1.1\r\nHost: 127.0.0.1:8720\r\nConnection: close\r\nAccept: text/event-stream, application/json\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`);
      await socket.write(head); if(body.length)await socket.write(body);
      const first=await line(),status=Number(first.match(/^HTTP\/1\.[01] (\d{3}) /)?.[1]);
      if(status<200||status>599||!status)throw Error('Ungültiger Operator-HTTP-Status');
      const headers = new Headers(); let headerBytes=0;
      for(let field=await line();field;field=await line()) { headerBytes+=field.length; const colon=field.indexOf(':'); if(headerBytes>32768||colon<1)throw Error('Ungültige Operator-HTTP-Header'); headers.append(field.slice(0,colon),field.slice(colon+1).trim()); }
      const chunked=/^chunked$/i.test(headers.get('transfer-encoding')??'');
      if(headers.has('transfer-encoding')&&!chunked)throw Error('Unbekannte Operator-Kodierung');
      let remaining=headers.has('content-length')?Number(headers.get('content-length')):undefined, chunk=0, finishChunk=false;
      if(remaining!==undefined&&(!Number.isSafeInteger(remaining)||remaining<0))throw Error('Ungültige Operator-Länge');
      if(status===204||status===304){await close();return new Response(null,{status,headers});}
      const stream=new ReadableStream<Uint8Array>({async pull(controller){
        try {
          signal?.throwIfAborted();
          if(chunked){
            if(finishChunk){if(await line()!=='')throw Error('Ungültiger Operator-Block');finishChunk=false;}
            if(!chunk){const size=await line();if(!/^[a-f0-9]+(?:;[^\r\n]*)?$/i.test(size))throw Error('Ungültiger Operator-Block');chunk=parseInt(size,16);if(!Number.isSafeInteger(chunk))throw Error('Operator-Block zu groß');if(!chunk){controller.close();await close();return;}}
          } else if(remaining===0){controller.close();await close();return;}
          if(!buffer.length&&!await more()){if(chunked||remaining)throw Error('Operator-Antwort unterbrochen');controller.close();await close();return;}
          const n=Math.min(buffer.length,chunked?chunk:remaining??buffer.length,65536);controller.enqueue(take(n));
          if(chunked){chunk-=n;finishChunk=chunk===0;}else if(remaining!==undefined)remaining-=n;
        } catch(e){controller.error(e);await close();}
      },cancel:close});
      // Body has already been decoded from HTTP chunk framing.
      headers.delete('transfer-encoding');return new Response(stream,{status,headers});
    } catch(e){await close();throw e;}
  };
}
