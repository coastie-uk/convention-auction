document.documentElement.classList.add("js");

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("show");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);

const highlight = () => {
  const scrollPos = window.scrollY + 120;
  let activeId = "";
  sections.forEach((section) => {
    if (section.offsetTop <= scrollPos) {
      activeId = section.id;
    }
  });
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${activeId}`);
  });
};

window.addEventListener("scroll", highlight, { passive: true });
window.addEventListener("load", highlight);
