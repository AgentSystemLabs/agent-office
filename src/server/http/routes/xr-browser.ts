import { XrSessions } from '../../xr-playtests/store.js';
import { PlaytestError } from '../../playtests.js';
import { floorParam } from './files.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
/** Session cookies keep the existing reverse-proxy Basic authentication intact. */
export const xrBrowserRoute: Route = {
  path:'/api/playtests/xr-browser',auth:'session',method:'POST',
  async handle(ctx,{req,res,url,session}) {
    if(!sameOrigin(req,ctx.cfg))return send(res,403,{error:'Forbidden'});
    const floor=floorParam(ctx,url);if(!floor)return send(res,404,{error:'No such floor'});
    try {
      const body=JSON.parse(await readBody(req,16500000));
      if(!body||typeof body.run!=='string'||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new PlaytestError('Ungültige Kopplung');
      const sessions=new XrSessions(floor.dir);
      sessions.view(session.account?.id??'shared',body.run,Date.now(),false); // Owner check before reading/writing telemetry.
      return send(res,200,sessions.ingest(body.run,body.token,body));
    }catch(e){return send(res,e instanceof PlaytestError?e.status:400,{error:e instanceof PlaytestError?e.message:'Ungültige Browser-Telemetrie'});}
  },
};
