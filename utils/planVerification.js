const { createSupabaseClient } = require('./supabase');

/**
 * @typedef {Object} UserPlan
 * @property {'free' | 'pay_as_you_go' | 'guaranteed_job' | 'monthly_subscription'} plan_type
 * @property {number} interviews_remaining
 * @property {number} minutes_per_interview
 * @property {string|null} expires_at
 * @property {string|null} subscription_status - e.g., 'active', 'canceled', 'past_due'
 * @property {string|null} stripe_subscription_id - Stripe subscription ID
 */

/**
 * @typedef {Object} PlanStatus
 * @property {boolean} canStart
 * @property {string} [reason]
 * @property {Object} plan
 * @property {string} plan.planType
 * @property {number} plan.interviewsRemaining
 * @property {number} plan.minutesPerInterview
 * @property {boolean} plan.isExpired
 * @property {string|null} plan.expiresAt
 * @property {boolean} plan.hasUnlimitedAccess
 * @property {boolean} plan.isRefunded
 */

const planCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Checks if a user has unlimited access by calling a database RPC function.
 * @param {string} userId The user ID.
 * @returns {Promise<boolean>} True if the user has unlimited access.
 */
async function checkUnlimitedAccess(userId) {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc('has_unlimited_access', { p_user_id: userId });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`[Plan] Error checking unlimited access for user ${userId}:`, error);
    return false;
  }
}

/**
 * Gets the detailed subscription status for a user.
 * @param {string} userId The user ID.
 * @returns {Promise<UserPlan|null>} The user's plan with subscription details.
 */
async function getSubscriptionStatus(userId) {
  const cached = planCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.plan;
  }

  try {
    const supabase = createSupabaseClient();
    const { data: plan, error } = await supabase
      .from('user_plans')
      .select('*, plan_type::text')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    const resultPlan = plan || {
      user_id: userId,
      plan_type: 'free',
      interviews_remaining: 10,
      minutes_per_interview: 5,
      expires_at: null,
      subscription_status: null,
      stripe_subscription_id: null,
    };

    planCache.set(userId, { plan: resultPlan, timestamp: Date.now() });
    return resultPlan;
  } catch (error) {
    console.error(`[Plan] Error in getSubscriptionStatus for user ${userId}:`, error);
    return {
      user_id: userId,
      plan_type: 'free',
      interviews_remaining: 10,
      minutes_per_interview: 5,
      expires_at: null,
      subscription_status: null,
      stripe_subscription_id: null,
    };
  }
}

/**
 * Syncs subscription status with Stripe (placeholder for backend call).
 */
async function syncSubscriptionStatus(userId) {
  // In a real app, this would trigger a backend function (e.g., Supabase Edge Function)
  // that securely communicates with Stripe to update the subscription status.
  console.log(`[Plan] Triggering subscription sync for user ${userId}`);
  planCache.delete(userId); // Invalidate cache to force a refresh
}

/**
 * Gets the comprehensive plan status for a user, including subscription details.
 * @param {string} userId The user ID.
 * @returns {Promise<PlanStatus>} The detailed plan status.
 */
async function getPlanStatus(userId) {
  try {
    const plan = await getSubscriptionStatus(userId);
    const hasUnlimitedAccess = await checkUnlimitedAccess(userId);
    const isRefunded = plan.subscription_status === 'refunded';

    if (isRefunded) {
      return {
        canStart: false,
        reason: 'Your subscription has been refunded, and access has been revoked.',
        plan: { ...plan, hasUnlimitedAccess: false, isRefunded: true },
      };
    }

    if (hasUnlimitedAccess) {
      return {
        canStart: true,
        plan: { ...plan, interviewsRemaining: -1, hasUnlimitedAccess: true, isRefunded: false },
      };
    }

    const isExpired = plan.expires_at ? new Date(plan.expires_at) < new Date() : false;
    if (plan.plan_type === 'guaranteed_job' && isExpired) {
      return {
        canStart: false,
        reason: 'Your guaranteed job plan has expired.',
        plan: { ...plan, hasUnlimitedAccess: false, isRefunded: false, isExpired: true },
      };
    }

    if (plan.interviews_remaining <= 0) {
      return {
        canStart: false,
        reason: "You've used all your interviews for this plan.",
        plan: { ...plan, hasUnlimitedAccess: false, isRefunded: false },
      };
    }

    return {
      canStart: true,
      plan: { ...plan, hasUnlimitedAccess: false, isRefunded: false },
    };
  } catch (error) {
    console.error(`[Plan] Error checking plan status for user ${userId}:`, error);
    return {
      canStart: false,
      reason: 'Unable to verify plan status. Please try again.',
      plan: {
        type: 'unknown',
        interviewsRemaining: 0,
        minutesPerInterview: 0,
        isExpired: false,
        expiresAt: null,
        hasUnlimitedAccess: false,
        isRefunded: false,
      },
    };
  }
}

/**
 * Decrements the interview count for a user if they do not have unlimited access.
 * @param {string} userId The user ID.
 * @returns {Promise<void>}
 */
async function decrementInterviewCount(userId) {
  try {
    const hasUnlimited = await checkUnlimitedAccess(userId);
    if (hasUnlimited) {
      console.log(`[Plan] Not decrementing interviews for user ${userId}: has unlimited access.`);
      return;
    }

    const supabase = createSupabaseClient();
    const { data: plan, error: fetchError } = await supabase
      .from('user_plans')
      .select('interviews_remaining')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!plan || plan.interviews_remaining === -1) {
      console.log(`[Plan] Not decrementing interviews for user ${userId}: no plan or legacy unlimited.`);
      return;
    }

    const { error: updateError } = await supabase
      .from('user_plans')
      .update({ interviews_remaining: plan.interviews_remaining - 1 })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    planCache.delete(userId); // Invalidate cache after decrementing
    console.log(`[Plan] Decremented interview count for user ${userId}.`);
  } catch (error) {
    console.error(`[Plan] Error decrementing interview count for user ${userId}:`, error);
    throw error;
  }
}

module.exports = {
  checkUnlimitedAccess,
  getSubscriptionStatus,
  syncSubscriptionStatus,
  getPlanStatus,
  decrementInterviewCount,
  // Deprecated, but kept for backward compatibility if needed.
  getUserPlan: getSubscriptionStatus, 
  checkUserPlan: async (userId) => {
    const status = await getPlanStatus(userId);
    return {
        maxInterviews: status.plan.hasUnlimitedAccess ? Infinity : status.plan.interviewsRemaining,
        maxMinutesPerInterview: status.plan.minutesPerInterview || 5,
        isUnlimited: status.plan.hasUnlimitedAccess
    };
  }
};