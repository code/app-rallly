import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { prisma } from "@/utils/prisma";
import newPollTemplate from "~/templates/new-poll";

import { absoluteUrl } from "../../../utils/absolute-url";
import { sendEmailTemplate } from "../../../utils/api-utils";
import {
  createToken,
  decryptToken,
  mergeGuestsIntoUser,
} from "../../../utils/auth";
import { publicProcedure, router } from "../../trpc";

export const verification = router({
  verify: publicProcedure
    .input(
      z.object({
        pollId: z.string(),
        code: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { pollId } = await decryptToken<{
        pollId: string;
      }>(input.code);

      if (pollId !== input.pollId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Poll id in token (${pollId}) did not match: ${input.pollId}`,
        });
      }

      const poll = await prisma.poll.update({
        where: {
          id: pollId,
        },
        data: {
          verified: true,
        },
        include: { user: true },
      });

      // If logged in as guest, we update all participants
      // and comments by this guest to the user that we just authenticated
      if (ctx.session.user?.isGuest) {
        await mergeGuestsIntoUser(poll.user.id, [ctx.session.user.id]);
      }

      ctx.session.user = {
        id: poll.user.id,
        isGuest: false,
      };
      await ctx.session.save();
    }),
  request: publicProcedure
    .input(
      z.object({
        pollId: z.string(),
        adminUrlId: z.string(),
      }),
    )
    .mutation(async ({ input: { pollId, adminUrlId } }) => {
      const poll = await prisma.poll.findUnique({
        where: {
          id: pollId,
        },
        include: {
          user: true,
        },
      });

      if (!poll) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Poll with id ${pollId} not found`,
        });
      }

      const homePageUrl = absoluteUrl();
      const pollUrl = `${homePageUrl}/admin/${adminUrlId}`;
      const token = await createToken({
        pollId,
      });
      const verifyEmailUrl = `${pollUrl}?code=${token}`;

      await sendEmailTemplate({
        templateString: newPollTemplate,
        to: poll.user.email,
        subject: "Please verify your email address",
        templateVars: {
          title: poll.title,
          name: poll.user.name,
          pollUrl,
          verifyEmailUrl,
          homePageUrl,
          supportEmail: process.env.SUPPORT_EMAIL,
        },
      });
    }),
});