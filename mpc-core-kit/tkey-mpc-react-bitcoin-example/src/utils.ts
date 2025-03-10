import BN from "bn.js";
import { encrypt, getPubKeyECC, Point, randomSelection, ShareStore } from "@tkey/common-types";
import EC from "elliptic";

import { generatePrivate } from "@toruslabs/eccrypto";
import { Client } from "@toruslabs/tss-client";
import * as tss from "@toruslabs/tss-lib";
import { EthereumSigningProvider } from "@web3auth-mpc/ethereum-provider";
import keccak256 from "keccak256";
import Web3 from "web3";
import type { provider } from "web3-core";
import { fetchLocalConfig } from "@toruslabs/fnd-base";
import { TORUS_NETWORK, TORUS_SAPPHIRE_NETWORK_TYPE } from "@toruslabs/constants";
import { utils } from "@toruslabs/tss-client";
import { Signer, SignerAsync } from "bitcoinjs-lib";
import { testnet } from "bitcoinjs-lib/src/networks";
import { debug } from "console";
const { getDKLSCoeff, setupSockets } = utils;

const network = TORUS_NETWORK.SAPPHIRE_DEVNET;
const parties = 4;
const clientIndex = parties - 1;
const tssImportUrl = `https://sapphire-dev-2-2.authnetwork.dev/tss/v1/clientWasm`;

const DELIMITERS = {
  Delimiter1: "\u001c",
  Delimiter2: "\u0015",
  Delimiter3: "\u0016",
  Delimiter4: "\u0017",
};

export function getEcCrypto(): any {
  // eslint-disable-next-line new-cap
  return new EC.ec("secp256k1");
}
const ec = getEcCrypto();

export function generateTSSEndpoints(parties: number, clientIndex: number, network: TORUS_SAPPHIRE_NETWORK_TYPE, nodeIndexes: number[] = []) {
  console.log("generateEndpoints node indexes", nodeIndexes);
  const networkConfig = fetchLocalConfig(network);
  if (!networkConfig) {
    throw new Error(`Invalid network: ${network}`);
  }

  if (!networkConfig.torusNodeTSSEndpoints) {
    throw new Error(`Invalid network: ${network}, endpoint not found`);
  }
  const endpoints = [];
  const tssWSEndpoints = [];
  const partyIndexes = [];

  for (let i = 0; i < parties; i++) {
    partyIndexes.push(i);

    if (i === clientIndex) {
      endpoints.push(null);
      tssWSEndpoints.push(null);
    } else {
      endpoints.push(networkConfig.torusNodeTSSEndpoints[nodeIndexes[i] ? nodeIndexes[i] - 1 : i]);
      tssWSEndpoints.push(networkConfig.torusNodeEndpoints[nodeIndexes[i] ? nodeIndexes[i] - 1 : i]);
    }
  }

  return {
    endpoints: endpoints,
    tssWSEndpoints: tssWSEndpoints,
    partyIndexes: partyIndexes,
  };
}

export const setupWeb3 = async (chainConfig: any, loginReponse: any, signingParams: any) => {
  try {
    const ethereumSigningProvider = new EthereumSigningProvider({
      config: {
        chainConfig,
      },
    });

    const { tssNonce, tssShare2, tssShare2Index, compressedTSSPubKey, signatures, ecPublicKey } = signingParams;
    // console.log("signingParams", compressedTSSPubKey.toString("hex"));

    const { verifier, verifierId } = loginReponse.userInfo;

    const vid = `${verifier}${DELIMITERS.Delimiter1}${verifierId}`;
    const sessionId = `${vid}${DELIMITERS.Delimiter2}default${DELIMITERS.Delimiter3}${tssNonce}${DELIMITERS.Delimiter4}`;

    /*
    pass user's private key here.
    after calling setupProvider, we can use
    */
    const sign = async (hash: Buffer, lowR?: boolean | undefined) => {
      const randomSessionNonce = keccak256(generatePrivate().toString("hex") + Date.now());

      // session is needed for authentication to the web3auth infrastructure holding the factor 1
      const currentSession = `${sessionId}${randomSessionNonce.toString("hex")}`;

      // 1. setup
      // generate endpoints for servers
      const { endpoints, tssWSEndpoints, partyIndexes } = generateTSSEndpoints(parties, clientIndex, network);

      // setup mock shares, sockets and tss wasm files.
      const [sockets] = await Promise.all([setupSockets(tssWSEndpoints as string[], randomSessionNonce.toString("hex")), tss.default(tssImportUrl)]);

      const participatingServerDKGIndexes = [1, 2, 3];
      const dklsCoeff = getDKLSCoeff(true, participatingServerDKGIndexes, tssShare2Index);
      const denormalisedShare = dklsCoeff.mul(tssShare2).umod(ec.curve.n);
      const share = Buffer.from(denormalisedShare.toString(16, 64), "hex").toString("base64");

      if (!currentSession) {
        throw new Error(`sessionAuth does not exist ${currentSession}`);
      }
      if (!signatures) {
        throw new Error(`Signature does not exist ${signatures}`);
      }

      const client = new Client(
        currentSession,
        clientIndex,
        partyIndexes,
        endpoints,
        sockets,
        share,
        Buffer.from(compressedTSSPubKey, "hex").toString("base64"),
        true,
        tssImportUrl
      );
      const serverCoeffs: any = {};
      for (let i = 0; i < participatingServerDKGIndexes.length; i++) {
        const serverIndex = participatingServerDKGIndexes[i];
        serverCoeffs[serverIndex] = getDKLSCoeff(false, participatingServerDKGIndexes, tssShare2Index, serverIndex).toString("hex");
      }
      // debugger;
      client.precompute(tss, { signatures, server_coeffs: serverCoeffs });
      console.log("client is ready");
      await client.ready();
      const { r, s, recoveryParam } = await client.sign(tss as any, Buffer.from(hash).toString("base64"), true, "", "keccak256", {
        signatures,
      });
      await client.cleanup(tss, { signatures, server_coeffs: serverCoeffs });
      const sig = {
        v: recoveryParam,
        r: Buffer.from(r.toString("hex").padStart(64, "0"), "hex"),
        s: Buffer.from(s.toString("hex").padStart(64, "0"), "hex"),
      };
      const sigBuffer = Buffer.concat([sig.r, sig.s]);
      return Promise.resolve(sigBuffer);
    };

    if (!compressedTSSPubKey) {
      throw new Error(`compressedTSSPubKey does not exist ${compressedTSSPubKey}`);
    }

    const getPublic: () => Promise<Buffer> = async () => {
      return compressedTSSPubKey;
    };

    const toAsyncSigner = (signer: Signer): SignerAsync => {
      const ret: SignerAsync = {
        publicKey: signer.publicKey,
        sign: (hash: Buffer, lowR?: boolean | undefined): Promise<Buffer> => {
          return new Promise((resolve, rejects): void => {
            // setTimeout(() => {
            try {
              // debugger;
              const r = signer.sign(hash, lowR);
              resolve(r);
            } catch (e) {
              rejects(e);
            }
            // }, 10);
          });
        },
        network: testnet,
      };
      return ret;
    };

    const btcSigner = toAsyncSigner({ publicKey: ecPublicKey, sign: sign as any });
    return btcSigner;
    // await ethereumSigningProvider.setupProvider({ sign, getPublic });
    // // console.log(ethereumSigningProvider.provider);
    // const web3 = new Web3(ethereumSigningProvider.provider as provider);
    // return web3;
  } catch (e) {
    console.error(e);
    return null;
  }
};

export type FactorKeyCloudMetadata = {
  deviceShare: ShareStore;
  tssShare: BN;
  tssIndex: number;
};

const fetchDeviceShareFromTkey = async (tKey: any) => {
  if (!tKey) {
    console.error("tKey not initialized yet");
    return;
  }
  try {
    const polyId = tKey.metadata.getLatestPublicPolynomial().getPolynomialID();
    const shares = tKey.shares[polyId];
    let deviceShare: ShareStore | null = null;

    for (const shareIndex in shares) {
      if (shareIndex !== "1") {
        deviceShare = shares[shareIndex];
      }
    }
    return deviceShare;
  } catch (err: any) {
    console.error({ err });
    throw new Error(err);
  }
};

export const addFactorKeyMetadata = async (tKey: any, factorKey: BN, tssShare: BN, tssIndex: number, factorKeyDescription: string) => {
  if (!tKey) {
    console.error("tKey not initialized yet");
    return;
  }
  const { requiredShares } = tKey.getKeyDetails();
  if (requiredShares > 0) {
    console.error("not enough shares for metadata key");
  }

  const metadataDeviceShare = await fetchDeviceShareFromTkey(tKey);

  const factorIndex = getPubKeyECC(factorKey).toString("hex");
  const metadataToSet: FactorKeyCloudMetadata = {
    deviceShare: metadataDeviceShare as ShareStore,
    tssShare,
    tssIndex,
  };

  // Set metadata for factor key backup
  await tKey.addLocalMetadataTransitions({
    input: [{ message: JSON.stringify(metadataToSet) }],
    privKey: [factorKey],
  });

  // also set a description on tkey
  const params = {
    module: factorKeyDescription,
    dateAdded: Date.now(),
    tssShareIndex: tssIndex,
  };
  await tKey.addShareDescription(factorIndex, JSON.stringify(params), true);
};

export const copyExistingTSSShareForNewFactor = async (tKey: any, newFactorPub: Point, factorKeyForExistingTSSShare: BN) => {
  if (!tKey) {
    throw new Error("tkey does not exist, cannot copy factor pub");
  }
  if (!tKey.metadata.factorPubs || !Array.isArray(tKey.metadata.factorPubs[tKey.tssTag])) {
    throw new Error("factorPubs does not exist, failed in copy factor pub");
  }
  if (!tKey.metadata.factorEncs || typeof tKey.metadata.factorEncs[tKey.tssTag] !== "object") {
    throw new Error("factorEncs does not exist, failed in copy factor pub");
  }

  const existingFactorPubs = tKey.metadata.factorPubs[tKey.tssTag].slice();
  const updatedFactorPubs = existingFactorPubs.concat([newFactorPub]);
  const { tssShare, tssIndex } = await tKey.getTSSShare(factorKeyForExistingTSSShare);

  const factorEncs = JSON.parse(JSON.stringify(tKey.metadata.factorEncs[tKey.tssTag]));
  const factorPubID = newFactorPub.x.toString(16, 64);
  factorEncs[factorPubID] = {
    tssIndex,
    type: "direct",
    userEnc: await encrypt(
      Buffer.concat([
        Buffer.from("04", "hex"),
        Buffer.from(newFactorPub.x.toString(16, 64), "hex"),
        Buffer.from(newFactorPub.y.toString(16, 64), "hex"),
      ]),
      Buffer.from(tssShare.toString(16, 64), "hex")
    ),
    serverEncs: [],
  };
  tKey.metadata.addTSSData({
    tssTag: tKey.tssTag,
    factorPubs: updatedFactorPubs,
    factorEncs,
  });
};

export const addNewTSSShareAndFactor = async (
  tKey: any,
  newFactorPub: Point,
  newFactorTSSIndex: number,
  factorKeyForExistingTSSShare: BN,
  signatures: any
) => {
  try {
    if (!tKey) {
      throw new Error("tkey does not exist, cannot add factor pub");
    }
    if (!(newFactorTSSIndex === 2 || newFactorTSSIndex === 3)) {
      throw new Error("tssIndex must be 2 or 3");
    }
    if (!tKey.metadata.factorPubs || !Array.isArray(tKey.metadata.factorPubs[tKey.tssTag])) {
      throw new Error("factorPubs does not exist");
    }

    const existingFactorPubs = tKey.metadata.factorPubs[tKey.tssTag].slice();
    const updatedFactorPubs = existingFactorPubs.concat([newFactorPub]);
    const existingTSSIndexes = existingFactorPubs.map((fb: any) => tKey.getFactorEncs(fb).tssIndex);
    const updatedTSSIndexes = existingTSSIndexes.concat([newFactorTSSIndex]);
    const { tssShare, tssIndex } = await tKey.getTSSShare(factorKeyForExistingTSSShare);

    tKey.metadata.addTSSData({
      tssTag: tKey.tssTag,
      factorPubs: updatedFactorPubs,
    });

    const rssNodeDetails = await tKey._getRssNodeDetails();
    const { serverEndpoints, serverPubKeys, serverThreshold } = rssNodeDetails;
    const randomSelectedServers = randomSelection(
      new Array(rssNodeDetails.serverEndpoints.length).fill(null).map((_, i) => i + 1),
      Math.ceil(rssNodeDetails.serverEndpoints.length / 2)
    );

    const verifierNameVerifierId = tKey.serviceProvider.getVerifierNameVerifierId();
    await tKey._refreshTSSShares(true, tssShare, tssIndex, updatedFactorPubs, updatedTSSIndexes, verifierNameVerifierId, {
      selectedServers: randomSelectedServers,
      serverEndpoints,
      serverPubKeys,
      serverThreshold,
      authSignatures: signatures,
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
};
