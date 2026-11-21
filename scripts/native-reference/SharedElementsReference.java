import dk.aau.cs.model.CPN.ColorType;
import dk.aau.cs.model.tapn.*;
import dk.aau.cs.model.tapn.simulation.*;
import dk.aau.cs.io.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.util.*;

/** Design observation harness, not a conformance assertion suite. See SHARED-ELEMENTS.md.
 * Native NetworkMarking.isDelayPossible consults the current GUI tab for shared places.
 * HeadlessMarking substitutes ONLY that predicate with its source-equivalent network lookup.
 * Forbidden incidence cases deliberately create arcs BEFORE makeShared to expose the
 * mutator loophole; they are not supported native nets.
 * All cloning, selection, consumption, production and XML IO remain released jar code.
 */
public class SharedElementsReference {
  static class HeadlessMarking extends NetworkMarking {
    final TimedArcPetriNetNetwork net;
    HeadlessMarking(TimedArcPetriNetNetwork net) { this.net = net; }
    public boolean isDelayPossible(BigDecimal d) {
      if (d.signum() < 0) return false;
      for (var e : getSharedPlacesTokens().entrySet())
        if (net.isSharedPlaceUsedInTemplates((SharedPlace)e.getKey()))
          for (var t : e.getValue()) if (!t.place().invariant().isSatisfied(t.age().add(d))) return false;
      for (var e : getMarkingMap().entrySet())
        if (e.getKey().isActive() && !e.getValue().isDelayPossible(d)) return false;
      return true;
    }
  }
  static TimedArcPetriNetNetwork n;
  static SharedPlace p;
  static SharedTransition s;
  static TimedArcPetriNet a, b;
  static TimedTransition ta, tb;
  static void setup(int count, boolean sharedInputs) {
    n = new TimedArcPetriNetNetwork(); n.setMarking(new HeadlessMarking(n));
    p = new SharedPlace("Pool"); n.add(p);
    s = new SharedTransition("Sync"); n.add(s);
    a = new TimedArcPetriNet("A"); b = new TimedArcPetriNet("B"); n.add(a); n.add(b);
    a.setActive(true); b.setActive(true); a.add(p); b.add(p);
    ta = new TimedTransition("ta"); tb = new TimedTransition("tb"); a.add(ta); b.add(tb);
    if (sharedInputs) {
      a.add(new TimedInputArc(p, ta, TimeInterval.ZERO_INF));
      b.add(new TimedInputArc(p, tb, TimeInterval.ZERO_INF));
    }
    s.makeShared(ta); s.makeShared(tb);
    for (int i=0; i<count; i++) p.addToken(new TimedToken(p, new BigDecimal(i+1), ColorType.COLORTYPE_DOT.getFirstColor()));
  }
  static void run(String label, Runnable op) {
    try { System.out.print(label + ": "); op.run(); }
    catch (Throwable e) { System.out.println(e.getClass().getSimpleName() + " " + e.getMessage()); }
  }
  static void fire(FiringMode mode) {
    var result = n.marking().fireTransition(ta, mode);
    System.out.println("enabled=" + s.isEnabled() + " consumed=" + result.value2().stream().map(t -> t.age().toPlainString()).toList()
      + " remaining=" + result.value1().getTokensFor(p).stream().map(t -> t.age().toPlainString()).toList()
      + " original=" + p.numberOfTokens());
  }
  public static void main(String[] args) throws Exception {
    run("constructor shared incidence", () -> { setup(0,false); a.add(new TimedInputArc(p,ta,TimeInterval.ZERO_INF)); });
    setup(1,true); run("one token, two demands", () -> fire(new OldestFiringMode()));
    setup(2,true); run("oldest two demands", () -> fire(new OldestFiringMode()));
    setup(2,true); run("youngest two demands", () -> fire(new YoungestFiringMode()));
    setup(1,true); run("random one token, two demands", () -> fire(new RandomFiringMode()));
    setup(1,true); run("manual shared token", () -> { n.marking().fireTransition(ta, new ArrayList<>(p.tokens())); System.out.println("ok"); });
    setup(1,true); b.setActive(false); run("inactive second member", () -> fire(new OldestFiringMode()));
    setup(0,false); a.setActive(false); b.setActive(false);
    run("all inactive", () -> System.out.println("enabled=" + s.isEnabled()));
    run("empty pool", () -> System.out.println("enabled=" + new SharedTransition("Empty").isEnabled()));
    setup(0,false); run("source synchronization", () -> fire(new OldestFiringMode()));
    setup(1,true); ta.unshare(); tb.unshare(); a.add(new TimedOutputArc(ta,p)); b.add(new TimedOutputArc(tb,p)); s.makeShared(ta); s.makeShared(tb);
    run("shared self loops", () -> fire(new OldestFiringMode()));
    setup(1,false); run("delay once", () -> System.out.println(n.marking().delay(new BigDecimal("2")).getTokensFor(p).get(0).age()));
    setup(1,false); a.setActive(false); b.setActive(false); p.setInvariant(new TimeInvariant(true,new IntBound(1)));
    run("unused invariant ignored, ages advance", () -> System.out.println(n.marking().delay(new BigDecimal("2")).getTokensFor(p).get(0).age()));
    setup(0,false); s.setUrgent(true);
    run("urgency propagation", () -> System.out.println(ta.isUrgent() + " " + tb.isUrgent()));
    setup(0,false); run("late urgent membership", () -> { s.setUrgent(true); var c=new TimedArcPetriNet("C"); n.add(c); var t=new TimedTransition("tc"); c.add(t); s.makeShared(t); System.out.println("pool="+s.isUrgent()+" member="+t.isUrgent()); });
    setup(0,false); run("valid local synchronization manual", () -> {
      var pa=new LocalTimedPlace("pa"); var pb=new LocalTimedPlace("pb"); a.add(pa); b.add(pb);
      a.add(new TimedInputArc(pa,ta,TimeInterval.ZERO_INF)); b.add(new TimedInputArc(pb,tb,TimeInterval.ZERO_INF));
      pa.addToken(new TimedToken(pa,new BigDecimal("2"),ColorType.COLORTYPE_DOT.getFirstColor()));
      pb.addToken(new TimedToken(pb,new BigDecimal("3"),ColorType.COLORTYPE_DOT.getFirstColor()));
      var tokens=new ArrayList<TimedToken>(); tokens.addAll(pa.tokens()); tokens.addAll(pb.tokens());
      var result=n.marking().fireTransition(ta,tokens);
      System.out.println("remaining="+result.getTokensFor(pa).size()+","+result.getTokensFor(pb).size());
    });
    setup(1,false); ta.unshare(); run("local transition shared transport", () -> {
      var q=new LocalTimedPlace("q",new TimeInvariant(true,new IntBound(1)),ColorType.COLORTYPE_DOT); a.add(q);
      a.add(new TransportArc(p,ta,q,TimeInterval.ZERO_INF));
      System.out.print("enabled="+ta.isEnabled());
      var result=n.marking().fireTransition(ta,new OldestFiringMode()).value1();
      System.out.println(" source="+result.getTokensFor(p).size()+" destination age="+result.getTokensFor(q).get(0).age());
      q.setInvariant(new TimeInvariant(false,new IntBound(1)));
      System.out.println("strict destination enabled="+ta.isEnabled());
    });
    Path dir=Files.createTempDirectory("shared-elements-io-");
    try {
      String xml="<pnml xmlns=\"http://www.informatik.hu-berlin.de/top/pnml/ptNetb\"><shared-place name=\"Pool\" invariant=\"&lt;= K\" initialMarking=\"2\"/><shared-transition name=\"Sync\" urgent=\"true\"/><constant name=\"K\" value=\"7\"/><net id=\"A\" active=\"true\" type=\"P/T net\"><place id=\"p1\" name=\"Pool\" invariant=\"&lt;= 1\" initialMarking=\"9\"/><transition id=\"t1\" name=\"Sync\" urgent=\"false\"/></net><feature isTimed=\"true\" isGame=\"false\" isColored=\"false\" isStochastic=\"false\"/></pnml>";
      Path input=dir.resolve("input.tapn"); Files.writeString(input,xml);
      run("XML redundant conflicts", () -> {
        try {
          var loaded=new TapnXmlLoader().load(input.toFile()); var net=loaded.network();
          System.out.println("pool count="+net.getSharedPlaceByName("Pool").numberOfTokens()+" invariant="+net.getSharedPlaceByName("Pool").invariant()+" pool urgent="+net.getSharedTransitionByName("Sync").isUrgent()+" member urgent="+loaded.templates().iterator().next().model().getTransitionByName("Sync").isUrgent());
          var out=dir.resolve("output.tapn");
          new TimedArcPetriNetNetworkWriter(net,loaded.templates(),loaded.queries(),net.constants(),loaded.getLens()).savePNML(out.toFile());
          System.out.println(Files.readString(out).replaceAll("(?s)<declaration>.*?</declaration>","<declaration/>").replaceAll("(?s)<hlinitialMarking>.*?</hlinitialMarking>","<hlinitialMarking/>").replaceAll("\\s+"," "));
        } catch(Exception e) { throw new RuntimeException(e); }
      });
    } finally { try(var files=Files.list(dir)) { for(var f:files.toList()) Files.delete(f); } Files.delete(dir); }
    System.exit(0);
  }
}
