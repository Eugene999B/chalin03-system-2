"use strict";

/**
 * A single bounded retry for the public, read-only Main Store catalogue.
 * Never use for POST, sale, inventory, payment or transaction operations.
 * A lost MySQL connection can fail the first pooled SELECT and then recover.
 */
const RETRYABLE_CONNECTION_CODES=new Set([
  "ETIMEDOUT","ECONNRESET","ECONNREFUSED","EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);

function isTransientCatalogueConnectionFailure(error){
 return RETRYABLE_CONNECTION_CODES.has(String(error?.code||""));
}

async function readCatalogueWithTransientRetry(read,options={}){
 if(typeof read!=="function")throw new TypeError("Catalogue read function required");
 const pause=options.pause||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 try{
  return await read();
 }catch(error){
  if(!isTransientCatalogueConnectionFailure(error))throw error;
  options.onRetry?.(String(error.code));
  await pause(450);
  return read(); // Exactly one retry of the idempotent SELECT; never an infinite loop.
 }
}

module.exports={isTransientCatalogueConnectionFailure,readCatalogueWithTransientRetry};
