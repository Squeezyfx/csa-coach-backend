import {checkOandaConnection} from './oanda-data.js';
try {
 const result=await checkOandaConnection({token:process.env.OANDA_API_TOKEN,environment:process.env.OANDA_ENVIRONMENT||'practice',price:process.env.OANDA_PRICE_COMPONENT||'B'});
 console.log(JSON.stringify(result,null,2));
} catch(error) {
 console.error(JSON.stringify({ok:false,category:error.category||'connection_error',message:error.category?error.message:'Could not connect to OANDA. Check network access and retry; no chart analysis was run.'},null,2));
 process.exitCode=1;
}
