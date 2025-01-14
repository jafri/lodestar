import {ELVerifiedRequestHandler} from "../interfaces.js";
import {ELBlock} from "../types.js";
import {fetchAndVerifyBlock} from "../utils/execution.js";
import {generateUnverifiedResponseForPayload} from "../utils/json_rpc.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const eth_getBlockByHash: ELVerifiedRequestHandler<[block: string, hydrated: boolean], ELBlock> = async ({
  handler,
  payload,
  logger,
  proofProvider,
}) => {
  const result = await fetchAndVerifyBlock({payload, proofProvider, logger, handler});

  if (result.valid) {
    return result.data;
  }

  logger.error("Request could not be verified.");
  return generateUnverifiedResponseForPayload(payload, "eth_getBlockByHash request can not be verified.");
};
