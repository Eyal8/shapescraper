package com.beno74.shapescraper;

import android.app.Activity;
import com.google.android.play.agesignals.*;
import com.google.android.play.agesignals.model.*;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

/** In-memory compliance decisions only. Never persist/log a range, source or install ID. */
final class RegionalAgeGate {
    static final class Decision {
        final String status;
        final boolean minor, childDirected;
        Decision(String status) { this(status, false, false); }
        Decision(String status, boolean minor, boolean childDirected) {
            this.status = status; this.minor = minor; this.childDirected = childDirected;
        }
    }
    private final AgeSignalsManager manager;
    private final Executor executor;
    RegionalAgeGate(AgeSignalsManager manager, Executor executor) {
        this.manager = manager; this.executor = executor;
    }
    void requirements(Consumer<Decision> done) {
        manager.getApplicableAgeFeatures(ApplicableAgeFeaturesRequest.builder().build())
            .addOnSuccessListener(executor, result -> {
                if (result.features() == null) done.accept(new Decision("unresolved"));
                else if (result.features().contains(ApplicableAgeFeature.MANDATORY_SHARING))
                    done.accept(new Decision("required"));
                else if (result.features().isEmpty()) done.accept(new Decision("notRequired"));
                else done.accept(new Decision("unresolved"));
            })
            .addOnFailureListener(executor, ignored -> done.accept(new Decision("unavailable")));
    }
    void request(Activity activity, Consumer<Decision> done) {
        // Re-check silently immediately before the only prompt-capable API.
        requirements(requirement -> {
            if (!"required".equals(requirement.status)) { done.accept(requirement); return; }
            manager.requestAgeSignalsAccess(AgeSignalsAccessRequest.builder().setActivity(activity).build())
                .addOnSuccessListener(executor, access -> {
                    Integer status = access.ageSignalsStatus();
                    if (status != null && status == AgeSignalsStatus.SHARED) {
                        manager.checkAgeSignals(AgeSignalsRequest.builder().build())
                            .addOnSuccessListener(executor, result -> done.accept(classify(result)))
                            .addOnFailureListener(executor, ignored -> done.accept(new Decision("unavailable")));
                    } else if (status != null && status == AgeSignalsStatus.VERIFICATION_REQUIRED) {
                        done.accept(new Decision("verificationRequired"));
                    } else {
                        done.accept(new Decision(status != null && status == AgeSignalsStatus.NOT_SHARED ? "declined" : "unresolved"));
                    }
                })
                .addOnFailureListener(executor, ignored -> done.accept(new Decision("unavailable")));
        });
    }
    static Decision classify(AgeSignalsResult result) {
        Integer change = result.significantChangeStatus();
        // Do not expose the affected monetization/measurement while approval is pending/declined.
        // This does not classify the current release as a significant update.
        if (change != null && (change == SignificantChangeStatus.PENDING || change == SignificantChangeStatus.DECLINED))
            return new Decision("unresolved");
        Integer lower = result.ageLower(), upper = result.ageUpper();
        if (lower == null || lower < 0 || lower > 18 || (upper != null && (upper < lower || upper > 18)))
            return new Decision("unresolved");
        // Google bounds are inclusive; an upper bound of 18 is NOT proof of minority.
        if (lower == 18) return new Decision("resolved", false, false);
        if (upper == null || upper >= 18) return new Decision("unresolved");
        return new Decision("resolved", true, lower < 13);
    }
}
