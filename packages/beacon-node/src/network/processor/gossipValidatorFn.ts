import {TopicValidatorResult} from "@libp2p/interface-pubsub";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {getGossipSSZType} from "../gossip/topic.js";
import {GossipValidatorFn, GossipHandlers, GossipHandlerFn} from "../gossip/interface.js";
import {GossipActionError, GossipAction} from "../../chain/errors/index.js";

export type ValidatorFnModules = {
  config: ChainForkConfig;
  logger: Logger;
  metrics: Metrics | null;
};

/**
 * Returns a GossipSub validator function from a GossipHandlerFn. GossipHandlerFn may throw GossipActionError if one
 * or more validation conditions from the consensus-specs#p2p-interface are not satisfied.
 *
 * This function receives a string topic and a binary message `InMessage` and deserializes both using caches.
 * - The topic string should be known in advance and pre-computed
 * - The message.data should already by uncompressed when computing its msgID
 *
 * All logging and metrics associated with gossip object validation should happen in this function. We want to know
 * - In debug logs what objects are we processing, the result and some succint metadata
 * - In metrics what's the throughput and ratio of accept/ignore/reject per type
 *
 * @see getGossipHandlers for reasoning on why GossipHandlerFn are used for gossip validation.
 */
export function getGossipValidatorFn(gossipHandlers: GossipHandlers, modules: ValidatorFnModules): GossipValidatorFn {
  const {logger, metrics} = modules;

  return async function gossipValidatorFn(topic, msg, propagationSource, seenTimestampSec) {
    const type = topic.type;

    // Define in scope above try {} to be used in catch {} if object was parsed
    let gossipObject;
    try {
      // Deserialize object from bytes ONLY after being picked up from the validation queue
      try {
        const sszType = getGossipSSZType(topic);
        gossipObject = sszType.deserialize(msg.data);
      } catch (e) {
        // TODO: Log the error or do something better with it
        return TopicValidatorResult.Reject;
      }

      await (gossipHandlers[type] as GossipHandlerFn)(
        gossipObject,
        topic,
        propagationSource,
        seenTimestampSec,
        msg.data
      );

      metrics?.gossipValidationAccept.inc({topic: type});

      return TopicValidatorResult.Accept;
    } catch (e) {
      if (!(e instanceof GossipActionError)) {
        // not deserve to log error here, it looks too dangerous to users
        logger.debug(`Gossip validation ${type} threw a non-GossipActionError`, {}, e as Error);
        return TopicValidatorResult.Ignore;
      }

      // Metrics on specific error reason
      // Note: LodestarError.code are bounded pre-declared error messages, not from arbitrary error.message
      metrics?.gossipValidationError.inc({topic: type, error: (e as GossipActionError<{code: string}>).type.code});

      switch (e.action) {
        case GossipAction.IGNORE:
          metrics?.gossipValidationIgnore.inc({topic: type});
          return TopicValidatorResult.Ignore;

        case GossipAction.REJECT:
          metrics?.gossipValidationReject.inc({topic: type});
          return TopicValidatorResult.Reject;
      }
    }
  };
}
