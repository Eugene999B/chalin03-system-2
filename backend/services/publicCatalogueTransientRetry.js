"use strict";

/**
 * A bounded recovery window for the public, read-only Main Store catalogue.
 * Railway's sleeping MySQL service can need several seconds to become ready:
 * retrying only once after 450 ms still returned a 503 during that wake-up.
 *
 * Do not apply this helper to orders, sales, payments or any write operation.
 * Fail fast for SQL errors and stop after five SELECT attempts at most.
 */
const RETRYABLE_CONNECTION_CODES=new Set([
  "ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);
const RECOVERY_DELAYS_MS=Object.freeze([450,900,1800,3200]);

function isTransientCatalogueConnectionFailure(error){
 return RETRYABLE_CONNECTION_CODES.has(String(error?.code||""));
}

async function readCatalogueWithTransientRetry(read,options={}){
 if(typeof read!=="function")throw new TypeError("Catalogue read function required");
 const pause=options.pause||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;attempt<=RECOVERY_DELAYS_MS.length;attempt++){
  try{
   return await read();
  }catch(error){
   if(!isTransientCatalogueConnectionFailure(error)||attempt===RECOVERY_DELAYS_MS.length)throw error;
   const delay=RECOVERY_DELAYS_MS[attempt];
   options.onRetry?.(String(error.code),attempt+1,delay);
   await pause(delay);
  }
 }
 throw new Error("Unreachable catalogue retry state");
}

module.exports={isTransientCatalogueConnectionFailure,readCatalogueWithTransientRetry,RECOVERY_DELAYS_MS};
